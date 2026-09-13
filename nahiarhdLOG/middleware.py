"""Pure-ASGI request logging middleware.

Framework-agnostic: this module must never import FastAPI/Starlette.
Works with any ASGI app; the FastAPI adapter only mounts it.
"""

from __future__ import annotations

import random
import time
import traceback
import uuid
from contextvars import ContextVar
from typing import Any, Awaitable, Callable, MutableMapping

from .collector import Collector
from .grouping import from_traceback

current_trace_id: ContextVar[str | None] = ContextVar(
    "nahiarhdlog_trace_id", default=None
)

Scope = MutableMapping[str, Any]
Message = MutableMapping[str, Any]
Receive = Callable[[], Awaitable[Message]]
Send = Callable[[Message], Awaitable[None]]


class LoggingMiddleware:
    """Records one `request` event per HTTP request (sampled; errors always)."""

    def __init__(
        self,
        app: Any,
        collector: Collector,
        sample_rate: float = 1.0,
        skip_prefixes: tuple[str, ...] | list[str] = (),
    ) -> None:
        if not 0.0 <= sample_rate <= 1.0:
            raise ValueError("sample_rate must be between 0.0 and 1.0")
        self.app = app
        self.collector = collector
        self.sample_rate = sample_rate
        self.skip_prefixes = tuple(skip_prefixes)

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
        trace_id = uuid.uuid4().hex
        token = current_trace_id.set(trace_id)
        start = time.perf_counter()
        status_holder: dict[str, int] = {}

        async def send_wrapper(message: Message) -> None:
            if message["type"] == "http.response.start":
                status_holder["status"] = int(message["status"])
            await send(message)

        try:
            await self.app(scope, receive, send_wrapper)
        except Exception as exc:
            duration_ms = (time.perf_counter() - start) * 1000
            exc_name = type(exc).__name__
            sig, _, _ = from_traceback(exc_name, exc.__traceback__)
            self.collector.emit(
                {
                    "type": "error",
                    "level": "CRITICAL",
                    "message": "".join(
                        traceback.format_exception(type(exc), exc, exc.__traceback__)
                    )[-8000:],
                    "trace_id": trace_id,
                    "data": {
                        "method": scope.get("method"),
                        "path": scope.get("path"),
                        "exc_type": exc_name,
                        "signature": sig,
                    },
                }
            )
            self.collector.emit(
                self._request_event(scope, 500, duration_ms, trace_id)
            )
            raise
        finally:
            current_trace_id.reset(token)
        duration_ms = (time.perf_counter() - start) * 1000
        status = status_holder.get("status", 500)
        if status >= 500 or random.random() < self.sample_rate:
            self.collector.emit(self._request_event(scope, status, duration_ms, trace_id))

    @staticmethod
    def _client_ip(scope: Scope) -> str | None:
        client = scope.get("client")
        if isinstance(client, (list, tuple)) and client:
            return str(client[0])
        return None

    @staticmethod
    def _user_agent(scope: Scope) -> str | None:
        for name, value in scope.get("headers", []):
            if name.lower() == b"user-agent":
                return value.decode("latin-1")[:300] or None
        return None

    @classmethod
    def _request_event(
        cls, scope: Scope, status: int, duration_ms: float, trace_id: str
    ) -> dict[str, Any]:
        query = scope.get("query_string", b"").decode("latin-1")
        path = scope.get("path", "")
        return {
            "type": "request",
            "level": None,
            "message": f"{scope.get('method', '?')} {path} -> {status} ({duration_ms:.1f}ms)",
            "trace_id": trace_id,
            "data": {
                "method": scope.get("method"),
                "path": path,
                "query": query,
                "status": status,
                "duration_ms": round(duration_ms, 3),
                "client": cls._client_ip(scope),
                "user_agent": cls._user_agent(scope),
            },
        }
