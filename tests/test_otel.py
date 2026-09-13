import time

import pytest

pytest.importorskip("opentelemetry.sdk")

from opentelemetry.sdk.trace import TracerProvider  # noqa: E402
from opentelemetry.sdk.trace.export import SimpleSpanProcessor  # noqa: E402
from opentelemetry.sdk.trace.export.in_memory_span_exporter import (  # noqa: E402
    InMemorySpanExporter,
)
from opentelemetry.trace import StatusCode  # noqa: E402

from nahiarhdLOG.otel import export_trace  # noqa: E402


def test_export_trace_keeps_trace_identity():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    tracer = provider.get_tracer("test")
    tid = "ab" * 16
    now = time.time()
    events = [
        {
            "ts": now,
            "type": "request",
            "message": "GET /x",
            "trace_id": tid,
            "data": {"method": "GET", "path": "/x", "status": 200, "duration_ms": 12.5},
        },
        {"ts": now + 0.1, "type": "log", "level": "INFO", "message": "hi",
         "trace_id": tid, "data": {"logger": "app"}},
        {"ts": now + 0.2, "type": "error", "level": "CRITICAL", "message": "bad",
         "trace_id": tid, "data": {"exc_type": "ValueError", "signature": "ValueError@x.py:1"}},
    ]
    assert export_trace(events, tracer=tracer) == 3
    spans = exporter.get_finished_spans()
    assert len(spans) == 3
    assert {s.context.trace_id for s in spans} == {int(tid, 16)}
    by_name = {s.name: s for s in spans}
    req = by_name["GET /x"]
    assert req.attributes["http.status_code"] == 200
    assert req.end_time - req.start_time == int(12.5 * 1_000_000)
    err = by_name["ValueError@x.py:1"]
    assert err.status.status_code == StatusCode.ERROR


def test_export_trace_empty_is_noop():
    exporter = InMemorySpanExporter()
    provider = TracerProvider()
    provider.add_span_processor(SimpleSpanProcessor(exporter))
    assert export_trace([], tracer=provider.get_tracer("t")) == 0
    assert exporter.get_finished_spans() == ()
