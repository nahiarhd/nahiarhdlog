"""W3C Trace Context version 00.

Source: https://www.w3.org/TR/trace-context-1/#traceparent-header
Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import re
import secrets
from typing import NamedTuple

# version-format = trace-id "-" parent-id "-" trace-flags  (version 00)
_TRACEPARENT = re.compile(
    r"^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$"
)
_ZERO_TRACE = "0" * 32
_ZERO_SPAN = "0" * 16


class Traceparent(NamedTuple):
    trace_id: str
    parent_id: str
    flags: str


def parse_traceparent(value: str | None) -> Traceparent | None:
    """Return a parsed header, or None if it must be ignored.

    Invalid version, non-hex, uppercase, all-zero ids, or missing fields
    restart the trace (spec: vendors MUST ignore the header).
    """
    if not value:
        return None
    match = _TRACEPARENT.fullmatch(value.strip())
    if match is None:
        return None
    version, trace_id, parent_id, flags = match.groups()
    if version == "ff":
        return None
    if trace_id == _ZERO_TRACE or parent_id == _ZERO_SPAN:
        return None
    return Traceparent(trace_id, parent_id, flags)


def new_trace_id() -> str:
    while True:
        value = secrets.token_hex(16)
        if value != _ZERO_TRACE:
            return value


def new_span_id() -> str:
    while True:
        value = secrets.token_hex(8)
        if value != _ZERO_SPAN:
            return value


def format_traceparent(trace_id: str, parent_id: str, flags: str = "01") -> str:
    return f"00-{trace_id}-{parent_id}-{flags}"
