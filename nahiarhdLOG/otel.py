"""Optional OpenTelemetry export. Requires the `otel` extra.

Maps one stored trace (a flat event list) to child spans of a remote
parent identified by our 128-bit hex trace_id, so exported traces keep
their identity in any OTEL backend.

Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import random
from typing import Any


def _require_otel() -> Any:
    try:
        from opentelemetry import trace

        return trace
    except ImportError as e:
        raise RuntimeError(
            "nahiarhdlog[otel] is not installed;"
            " run pip install 'nahiarhdlog[otel]'"
        ) from e


def export_trace(
    events: list[dict[str, Any]], tracer: Any = None, trace_id: str | None = None
) -> int:
    """Export stored events as OTEL spans. Returns the spans created."""
    trace = _require_otel()
    if not events:
        return 0
    tid = trace_id or events[0].get("trace_id")
    tracer = tracer or trace.get_tracer("nahiarhdlog")
    parent_ctx = None
    if tid:
        try:
            trace_id_int = int(tid, 16)
        except (TypeError, ValueError):
            trace_id_int = 0
        if trace_id_int:
            span_ctx = trace.SpanContext(
                trace_id=trace_id_int,
                span_id=random.getrandbits(64) or 1,
                is_remote=True,
                # We kept this trace locally, so mark it sampled; otherwise a
                # ParentBased sampler drops every exported child span.
                trace_flags=trace.TraceFlags(trace.TraceFlags.SAMPLED),
            )
            parent_ctx = trace.set_span_in_context(trace.NonRecordingSpan(span_ctx))
    created = 0
    for event in events:
        data = event.get("data") or {}
        start_ns = int((event.get("ts") or 0) * 1_000_000_000)
        end_ns = start_ns + 1_000_000
        etype = event.get("type", "log")
        if etype == "request" and data.get("duration_ms") is not None:
            end_ns = start_ns + int(data["duration_ms"] * 1_000_000)
            name = f"{data.get('method', '?')} {data.get('path', '?')}"
        elif etype == "error":
            name = str(data.get("signature") or "error")
        else:
            name = f"log:{(event.get('message') or '')[:60]}"
        span = tracer.start_span(name, context=parent_ctx, start_time=start_ns)
        try:
            span.set_attribute("nahiarhdlog.type", etype)
            if event.get("level"):
                span.set_attribute("nahiarhdlog.level", event["level"])
            if event.get("trace_id"):
                span.set_attribute("nahiarhdlog.trace_id", event["trace_id"])
            if data.get("method") is not None:
                span.set_attribute("http.method", data["method"])
            if data.get("status") is not None:
                span.set_attribute("http.status_code", data["status"])
            for key in ("path", "query", "duration_ms"):
                if data.get(key) is not None:
                    span.set_attribute(f"nahiarhdlog.{key}", data[key])
            for key in ("exc_type", "signature", "logger"):
                if data.get(key) is not None:
                    span.set_attribute(f"nahiarhdlog.{key}", data[key])
            if etype == "error":
                span.set_status(
                    trace.Status(
                        trace.StatusCode.ERROR, (event.get("message") or "")[:500]
                    )
                )
        finally:
            span.end(end_time=end_ns)
        created += 1
    return created
