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
