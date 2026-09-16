"""Error signatures for grouping: `ExcType@file.py:lineno`.

Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import os
import traceback
from types import TracebackType


def signature(exc_type_name: str, filename: str | None, lineno: int | None) -> str:
    base = os.path.basename(filename) if filename else "?"
    return f"{exc_type_name or '?'}@{base}:{lineno or 0}"


def from_traceback(
    exc_type_name: str, tb: TracebackType | None
) -> tuple[str, str | None, int | None]:
    """Return (signature, filename, lineno) for the innermost frame."""
    if tb is None:
        return signature(exc_type_name, None, None), None, None
    frames = traceback.extract_tb(tb)
    if not frames:
        return signature(exc_type_name, None, None), None, None
    last = frames[-1]
    return (
        signature(exc_type_name, last.filename, last.lineno),
        last.filename,
        last.lineno,
    )


DEFAULT_MAX_MESSAGE = 65_536


def truncate_message(message: str, max_chars: int = DEFAULT_MAX_MESSAGE) -> str:
    """Intelligently truncate long messages and tracebacks.

    Preserves both the start (header / log message / entry frames) and the end
    (innermost frames, local variables, exception name & message) without splitting
    tokens or lines.
    """
    if len(message) <= max_chars:
        return message

    marker_template = "\n\n[... {count} characters truncated ...]\n\n"
    budget = max_chars - 80
    if budget <= 0:
        return message[-max_chars:]

    head_budget = max(100, budget // 3)
    tail_budget = budget - head_budget

    head_sub = message[:head_budget]
    head_nl = head_sub.rfind("\n")
    if head_nl > head_budget // 2:
        head = head_sub[:head_nl]
    else:
        head = head_sub

    tail_sub = message[-tail_budget:]
    tail_nl = tail_sub.find("\n")
    if tail_nl != -1 and tail_nl < tail_budget // 2:
        tail = tail_sub[tail_nl + 1 :]
    else:
        tail = tail_sub

    omitted = len(message) - len(head) - len(tail)
    marker = marker_template.format(count=omitted)
    return head + marker + tail

