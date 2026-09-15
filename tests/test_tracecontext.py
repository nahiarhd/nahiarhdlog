"""W3C Trace Context version 00 — parse, reject, format.

Source: https://www.w3.org/TR/trace-context-1/#traceparent-header
"""

from nahiarhdLOG.tracecontext import (
    format_traceparent,
    new_span_id,
    new_trace_id,
    parse_traceparent,
)

# Example from the spec: sampled request.
_SPEC = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"


def test_parse_spec_example():
    parsed = parse_traceparent(_SPEC)
    assert parsed is not None
    assert parsed.trace_id == "4bf92f3577b34da6a3ce929d0e0e4736"
    assert parsed.parent_id == "00f067aa0ba902b7"
    assert parsed.flags == "01"


def test_parse_rejects_all_zero_ids():
    assert parse_traceparent("00-" + "0" * 32 + "-" + "0" * 16 + "-01") is None
    assert (
        parse_traceparent(
            "00-4bf92f3577b34da6a3ce929d0e0e4736-" + "0" * 16 + "-01"
        )
        is None
    )


def test_parse_rejects_uppercase_and_junk():
    assert parse_traceparent(_SPEC.upper()) is None
    assert parse_traceparent("not-a-header") is None
    assert parse_traceparent(None) is None
    assert parse_traceparent("") is None


def test_format_roundtrip():
    assert format_traceparent(*_SPEC.split("-")[1:]) == _SPEC


def test_generated_ids_are_valid_hex_and_nonzero():
    tid = new_trace_id()
    sid = new_span_id()
    assert len(tid) == 32 and set(tid) <= set("0123456789abcdef") and tid != "0" * 32
    assert len(sid) == 16 and set(sid) <= set("0123456789abcdef") and sid != "0" * 16
    assert parse_traceparent(format_traceparent(tid, sid, "01")) is not None
