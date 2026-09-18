"""Span and AI Agent tracing.

Framework-agnostic: this module must never import FastAPI/Starlette.
Works with any sync or async code, context manager, or decorator.
"""

from __future__ import annotations

import functools
import inspect
import time
from typing import Any, Callable

from .collector import Collector, get_active_collector
from .tracecontext import current_span_id, current_trace_id, new_span_id, new_trace_id


class Span:
    """A trace span representing an execution unit (e.g., function, step, tool, db query)."""

    def __init__(
        self,
        name: str,
        span_type: str = "custom",
        trace_id: str | None = None,
        parent_span_id: str | None = None,
        collector: Collector | None = None,
        input_data: Any = None,
        **extra_data: Any,
    ) -> None:
        self.name = name
        self.span_type = span_type
        self._explicit_trace_id = trace_id
        self._explicit_parent_span_id = parent_span_id
        self.collector = collector
        self.input_data = input_data
        self.output_data: Any = None
        self.extra_data: dict[str, Any] = dict(extra_data)
        self.status = "ok"
        self.error_info: dict[str, Any] | None = None

        self.trace_id: str = ""
        self.span_id: str = ""
        self.parent_span_id: str | None = None
        self.duration_ms: float = 0.0
        self.start_time: float = 0.0
        self.ts: float = 0.0

        self._trace_token: Any = None
        self._span_token: Any = None
        self._is_trace_root = False

    def set_input(self, data: Any) -> None:
        self.input_data = data

    def set_output(self, data: Any) -> None:
        self.output_data = data

    def set_attribute(self, key: str, value: Any) -> None:
        self.extra_data[key] = value

    def set_error(self, exc_or_msg: Exception | str) -> None:
        self.status = "error"
        if isinstance(exc_or_msg, BaseException):
            self.error_info = {
                "exc_type": type(exc_or_msg).__name__,
                "exc_message": str(exc_or_msg),
            }
        else:
            self.error_info = {"exc_message": str(exc_or_msg)}

    def __enter__(self) -> Span:
        self._start()
        return self

    def __exit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        if exc_val is not None:
            self.set_error(exc_val)
        self._finish()

    async def __aenter__(self) -> Span:
        self._start()
        return self

    async def __aexit__(
        self,
        exc_type: type[BaseException] | None,
        exc_val: BaseException | None,
        exc_tb: Any,
    ) -> None:
        if exc_val is not None:
            self.set_error(exc_val)
        self._finish()

    def __call__(self, fn: Callable[..., Any]) -> Callable[..., Any]:
        if inspect.iscoroutinefunction(fn):

            @functools.wraps(fn)
            async def async_wrapper(*args: Any, **kwargs: Any) -> Any:
                async with self:
                    return await fn(*args, **kwargs)

            return async_wrapper
        else:

            @functools.wraps(fn)
            def sync_wrapper(*args: Any, **kwargs: Any) -> Any:
                with self:
                    return fn(*args, **kwargs)

            return sync_wrapper

    def _start(self) -> None:
        self.start_time = time.perf_counter()
        self.ts = time.time()
        self.span_id = new_span_id()

        active_trace = self._explicit_trace_id or current_trace_id.get()
        if not active_trace:
            self.trace_id = new_trace_id()
            self._trace_token = current_trace_id.set(self.trace_id)
            self._is_trace_root = True
        else:
            self.trace_id = active_trace

        self.parent_span_id = (
            self._explicit_parent_span_id or current_span_id.get()
        )
        self._span_token = current_span_id.set(self.span_id)

    def _finish(self) -> None:
        try:
            self.duration_ms = (time.perf_counter() - self.start_time) * 1000
            coll = self.collector or get_active_collector()
            if coll is not None:
                coll.emit(self._to_event())
        finally:
            if self._span_token is not None:
                current_span_id.reset(self._span_token)
                self._span_token = None
            if self._trace_token is not None:
                current_trace_id.reset(self._trace_token)
                self._trace_token = None

    def _to_event(self) -> dict[str, Any]:
        msg = f"[{self.span_type}] {self.name} ({self.duration_ms:.1f}ms)"
        if self.status == "error":
            err_desc = (
                self.error_info.get("exc_message")
                if self.error_info
                else "failed"
            )
            msg += f" -> error: {err_desc}"

        data: dict[str, Any] = {
            "name": self.name,
            "span_type": self.span_type,
            "span_id": self.span_id,
            "parent_span_id": self.parent_span_id,
            "duration_ms": round(self.duration_ms, 3),
            "status": self.status,
            **self.extra_data,
        }
        if self.input_data is not None:
            data["input"] = self.input_data
        if self.output_data is not None:
            data["output"] = self.output_data
        if self.error_info:
            data["error"] = self.error_info

        return {
            "type": "span",
            "level": "ERROR" if self.status == "error" else "INFO",
            "message": msg,
            "trace_id": self.trace_id,
            "ts": self.ts,
            "data": data,
        }


class AISpan(Span):
    """Specialized span for AI agents, LLM calls, embeddings, and tool executions."""

    def __init__(
        self,
        name: str = "llm_call",
        model: str | None = None,
        messages: Any = None,
        system_prompt: str | None = None,
        tools: Any = None,
        span_type: str = "llm",
        trace_id: str | None = None,
        parent_span_id: str | None = None,
        collector: Collector | None = None,
        **extra_data: Any,
    ) -> None:
        super().__init__(
            name=name,
            span_type=span_type,
            trace_id=trace_id,
            parent_span_id=parent_span_id,
            collector=collector,
            **extra_data,
        )
        self.model = model
        self.messages = messages
        self.system_prompt = system_prompt
        self.tools = tools
        self.completion: Any = None
        self.prompt_tokens: int | None = None
        self.completion_tokens: int | None = None
        self.total_tokens: int | None = None
        self.tool_calls: list[Any] | None = None

    def set_model(self, model: str) -> None:
        self.model = model

    def set_messages(self, messages: Any) -> None:
        self.messages = messages

    def set_system_prompt(self, system_prompt: str) -> None:
        self.system_prompt = system_prompt

    def set_completion(self, completion: Any) -> None:
        self.completion = completion
        if self.output_data is None:
            self.output_data = completion

    def set_tokens(
        self,
        prompt_tokens: int | None = None,
        completion_tokens: int | None = None,
        total_tokens: int | None = None,
    ) -> None:
        if prompt_tokens is not None:
            self.prompt_tokens = int(prompt_tokens)
        if completion_tokens is not None:
            self.completion_tokens = int(completion_tokens)
        if total_tokens is not None:
            self.total_tokens = int(total_tokens)
        elif self.prompt_tokens is not None and self.completion_tokens is not None:
            self.total_tokens = self.prompt_tokens + self.completion_tokens

    def set_tool_calls(self, tool_calls: list[Any]) -> None:
        self.tool_calls = tool_calls

    def _to_event(self) -> dict[str, Any]:
        event = super()._to_event()
        data = event["data"]

        if self.model:
            data["model"] = self.model
        if self.system_prompt:
            data["system_prompt"] = self.system_prompt
        if self.messages is not None:
            data["messages"] = self.messages
        if self.tools is not None:
            data["tools"] = self.tools
        if self.completion is not None:
            data["completion"] = self.completion
        if self.prompt_tokens is not None:
            data["prompt_tokens"] = self.prompt_tokens
        if self.completion_tokens is not None:
            data["completion_tokens"] = self.completion_tokens
        if self.total_tokens is not None:
            data["total_tokens"] = self.total_tokens
        if self.tool_calls is not None:
            data["tool_calls"] = self.tool_calls

        tok_str = f" - {self.total_tokens} tokens" if self.total_tokens else ""
        model_str = f" [{self.model}]" if self.model else ""
        event["message"] = (
            f"[{self.span_type}{model_str}] {self.name} ({self.duration_ms:.1f}ms){tok_str}"
        )
        if self.status == "error":
            err_desc = (
                self.error_info.get("exc_message")
                if self.error_info
                else "failed"
            )
            event["message"] += f" -> error: {err_desc}"

        return event


def span(
    name: str,
    span_type: str = "custom",
    trace_id: str | None = None,
    parent_span_id: str | None = None,
    collector: Collector | None = None,
    input_data: Any = None,
    **extra_data: Any,
) -> Span:
    """Create a new Span for tracing functions, tool calls, or background operations."""
    return Span(
        name=name,
        span_type=span_type,
        trace_id=trace_id,
        parent_span_id=parent_span_id,
        collector=collector,
        input_data=input_data,
        **extra_data,
    )


def ai_span(
    name: str = "llm_call",
    model: str | None = None,
    messages: Any = None,
    system_prompt: str | None = None,
    tools: Any = None,
    span_type: str = "llm",
    trace_id: str | None = None,
    parent_span_id: str | None = None,
    collector: Collector | None = None,
    **extra_data: Any,
) -> AISpan:
    """Create an AISpan for tracing AI agent LLM calls, embeddings, and tool executions."""
    return AISpan(
        name=name,
        model=model,
        messages=messages,
        system_prompt=system_prompt,
        tools=tools,
        span_type=span_type,
        trace_id=trace_id,
        parent_span_id=parent_span_id,
        collector=collector,
        **extra_data,
    )
