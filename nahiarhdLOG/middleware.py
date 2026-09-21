"""Pure-ASGI request logging middleware.

Framework-agnostic: this module must never import FastAPI/Starlette.
Works with any ASGI app; the FastAPI adapter only mounts it.
"""

from __future__ import annotations

import json
import random
import time
import traceback
from contextvars import ContextVar
from typing import Any, Awaitable, Callable, MutableMapping

from .collector import Collector
from .grouping import from_traceback, truncate_message
from .tracecontext import (
    current_span_id,
    current_trace_id,
    format_traceparent,
    new_span_id,
    new_trace_id,
    parse_traceparent,
)

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]

_SENSITIVE_HEADERS = frozenset(
    {
        "authorization",
        "proxy-authorization",
        "cookie",
        "set-cookie",
        "x-api-key",
        "api-key",
        "x-auth-token",
    }
)

_SENSITIVE_EXACT_KEYS = frozenset(
    {
        "password",
        "secret",
        "token",
        "api_key",
        "apikey",
        "access_token",
        "refresh_token",
        "auth_token",
        "private_key",
        "secret_key",
        "client_secret",
    }
)

_SENSITIVE_KEY_SUBSTRINGS = (
    "password",
    "secret",
    "apikey",
    "api_key",
    "access_token",
    "refresh_token",
    "auth_token",
    "private_key",
    "client_secret",
)


def _is_sensitive_key(key: str) -> bool:
    k = key.lower()
    if k in _SENSITIVE_EXACT_KEYS:
        return True
    return any(s in k for s in _SENSITIVE_KEY_SUBSTRINGS)


def _redact_value(val: Any) -> Any:
    if isinstance(val, dict):
        return {
            k: (
                "[REDACTED]"
                if _is_sensitive_key(str(k))
                else _redact_value(v)
            )
            for k, v in val.items()
        }
    if isinstance(val, list):
        return [_redact_value(item) for item in val]
    return val


def _decode_body(raw: bytes, truncated: bool) -> Any:
    if not raw:
        return None
    try:
        text = raw.decode("utf-8")
        try:
            parsed = json.loads(text)
            redacted = _redact_value(parsed)
            if truncated and isinstance(redacted, dict):
                redacted["_truncated"] = True
            return redacted
        except Exception:
            if truncated:
                return text + "\n... [truncated]"
            return text
    except UnicodeDecodeError:
        return f"<binary data ({len(raw)} bytes)>"


class LoggingMiddleware:
    """Records one `request` event per HTTP request (sampled; errors always)."""

    def __init__(
        self,
        app: Any,
        collector: Collector,
        sample_rate: float = 1.0,
        skip_prefixes: tuple[str, ...] | list[str] = (),
        capture_body: bool = True,
        max_body_size: int = 65536,
    ) -> None:
        if not 0.0 <= sample_rate <= 1.0:
            raise ValueError("sample_rate must be between 0.0 and 1.0")
        self.app = app
        self.collector = collector
        self.sample_rate = sample_rate
        self.skip_prefixes = tuple(skip_prefixes)
        self.capture_body = capture_body
        self.max_body_size = max(0, int(max_body_size))

    @staticmethod
    def _skipped(path: str, prefixes: tuple[str, ...]) -> bool:
        for prefix in prefixes:
            norm = prefix.rstrip("/") or "/"
            if norm == "/" or path == norm or path.startswith(norm + "/"):
                return True
        return False

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope.get("type") != "http":
            await self.app(scope, receive, send)
            return
        if self._skipped(scope.get("path", ""), self.skip_prefixes):
            await self.app(scope, receive, send)
            return
        incoming = parse_traceparent(self._header(scope, b"traceparent"))
        trace_id = incoming.trace_id if incoming else new_trace_id()
        span_id = new_span_id()
        flags = incoming.flags if incoming else "01"
        outgoing = format_traceparent(trace_id, span_id, flags)
        token = current_trace_id.set(trace_id)
        start = time.perf_counter()
        wall_start = time.time()
        status_holder: dict[str, int] = {}

        # Capture request body safely
        req_chunks = bytearray()
        req_truncated = False
        buffered_messages: list[Message] = []

        if self.capture_body and scope.get("method") in (
            "POST",
            "PUT",
            "PATCH",
            "DELETE",
        ):
            try:
                msg = await receive()
                buffered_messages.append(msg)
                if msg.get("type") == "http.request":
                    chunk = msg.get("body", b"")
                    if chunk:
                        take = min(len(chunk), self.max_body_size)
                        req_chunks.extend(chunk[:take])
                        if len(chunk) > take:
                            req_truncated = True
            except Exception:
                pass

        async def wrapped_receive() -> Message:
            nonlocal req_truncated
            if buffered_messages:
                return buffered_messages.pop(0)
            msg = await receive()
            if msg.get("type") == "http.request" and self.capture_body:
                chunk = msg.get("body", b"")
                if chunk:
                    space = self.max_body_size - len(req_chunks)
                    if space > 0:
                        take = min(len(chunk), space)
                        req_chunks.extend(chunk[:take])
                        if len(chunk) > take:
                            req_truncated = True
                    else:
                        req_truncated = True
            return msg

        resp_chunks = bytearray()
        resp_headers: dict[str, str] = {}
        resp_truncated = False

        async def send_wrapper(message: Message) -> None:
            nonlocal resp_truncated
            if message["type"] == "http.response.start":
                status_holder["status"] = int(message["status"])
                headers = list(message.get("headers") or [])
                headers.append((b"traceparent", outgoing.encode("ascii")))
                if self.capture_body:
                    for k, v in headers:
                        k_str = k.decode("latin-1", errors="ignore").lower()
                        v_str = v.decode("latin-1", errors="ignore")
                        if k_str in _SENSITIVE_HEADERS:
                            resp_headers[k_str] = "[REDACTED]"
                        else:
                            resp_headers[k_str] = v_str
                message = {**message, "headers": headers}
            elif message["type"] == "http.response.body" and self.capture_body:
                chunk = message.get("body", b"")
                if chunk:
                    space = self.max_body_size - len(resp_chunks)
                    if space > 0:
                        take = min(len(chunk), space)
                        resp_chunks.extend(chunk[:take])
                        if len(chunk) > take:
                            resp_truncated = True
                    else:
                        resp_truncated = True
            await send(message)

        try:
            await self.app(scope, wrapped_receive, send_wrapper)
        except Exception as exc:
            duration_ms = (time.perf_counter() - start) * 1000
            exc_name = type(exc).__name__
            sig, _, _ = from_traceback(exc_name, exc.__traceback__)
            raw_tb = "".join(
                traceback.format_exception(type(exc), exc, exc.__traceback__)
            )
            self.collector.emit(
                {
                    "type": "error",
                    "level": "CRITICAL",
                    "message": truncate_message(raw_tb),
                    "trace_id": trace_id,
                    "data": {
                        "method": scope.get("method"),
                        "path": scope.get("path"),
                        "exc_type": exc_name,
                        "exc_message": str(exc),
                        "signature": sig,
                    },
                }
            )
            self.collector.emit(
                self._request_event(
                    scope,
                    500,
                    duration_ms,
                    trace_id,
                    parent_id=incoming.parent_id if incoming else None,
                    capture_body=self.capture_body,
                    req_body=bytes(req_chunks) if req_chunks else None,
                    req_truncated=req_truncated,
                    resp_body=bytes(resp_chunks) if resp_chunks else None,
                    resp_truncated=resp_truncated,
                    resp_headers=resp_headers if resp_headers else None,
                )
            )
            raise
        finally:
            current_trace_id.reset(token)
        duration_ms = (time.perf_counter() - start) * 1000
        status = status_holder.get("status", 500)
        if status >= 500 or random.random() < self.sample_rate:
            self.collector.emit(
                self._request_event(
                    scope,
                    status,
                    duration_ms,
                    trace_id,
                    parent_id=incoming.parent_id if incoming else None,
                    capture_body=self.capture_body,
                    req_body=bytes(req_chunks) if req_chunks else None,
                    req_truncated=req_truncated,
                    resp_body=bytes(resp_chunks) if resp_chunks else None,
                    resp_truncated=resp_truncated,
                    resp_headers=resp_headers if resp_headers else None,
                    ts=wall_start,
                )
            )

    @staticmethod
    def _client_ip(scope: Scope) -> str | None:
        client = scope.get("client")
        if isinstance(client, (list, tuple)) and client:
            return str(client[0])
        return None

    @staticmethod
    def _header(scope: Scope, name: bytes) -> str | None:
        target = name.lower()
        for key, value in scope.get("headers", []):
            if key.lower() == target:
                return value.decode("latin-1") or None
        return None

    @staticmethod
    def _user_agent(scope: Scope) -> str | None:
        raw = LoggingMiddleware._header(scope, b"user-agent")
        return raw[:300] if raw else None

    @staticmethod
    def _request_headers(scope: Scope) -> dict[str, str]:
        res: dict[str, str] = {}
        for key, value in scope.get("headers", []):
            k = key.decode("latin-1", errors="ignore").lower()
            v = value.decode("latin-1", errors="ignore")
            if k in _SENSITIVE_HEADERS:
                res[k] = "[REDACTED]"
            else:
                res[k] = v
        return res

    @classmethod
    def _request_event(
        cls,
        scope: Scope,
        status: int,
        duration_ms: float,
        trace_id: str,
        parent_id: str | None = None,
        capture_body: bool = False,
        req_body: bytes | None = None,
        req_truncated: bool = False,
        resp_body: bytes | None = None,
        resp_truncated: bool = False,
        resp_headers: dict[str, str] | None = None,
        ts: float | None = None,
    ) -> dict[str, Any]:
        query = scope.get("query_string", b"").decode("latin-1")
        path = scope.get("path", "")
        data: dict[str, Any] = {
            "method": scope.get("method"),
            "path": path,
            "query": query,
            "status": status,
            "duration_ms": round(duration_ms, 3),
            "client": cls._client_ip(scope),
            "user_agent": cls._user_agent(scope),
        }
        if parent_id:
            data["parent_id"] = parent_id
        if capture_body:
            req_headers = cls._request_headers(scope)
            if req_headers:
                data["request_headers"] = req_headers
            if req_body is not None:
                data["request_body"] = _decode_body(req_body, req_truncated)
            if resp_headers:
                data["response_headers"] = resp_headers
            if resp_body is not None:
                data["response_body"] = _decode_body(resp_body, resp_truncated)
        event: dict[str, Any] = {
            "type": "request",
            "level": None,
            "message": f"{scope.get('method', '?')} {path} -> {status} ({duration_ms:.1f}ms)",
            "trace_id": trace_id,
            "data": data,
        }
        if ts is not None:
            event["ts"] = ts
        return event
