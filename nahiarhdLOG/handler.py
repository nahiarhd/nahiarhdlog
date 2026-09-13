"""Capture stdlib `logging` records and uncaught exceptions.

Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import logging
import sys
import traceback
from types import TracebackType
from typing import Any, Callable

from .collector import Collector
from .grouping import from_traceback, signature
from .middleware import current_trace_id

_MAX_MESSAGE = 8000
# stdlib and loguru tracebacks both start with this header line.
_TRACEBACK_MARKER = "Traceback (most recent call last)"


class NahiarhdHandler(logging.Handler):
    """A `logging.Handler` that forwards records to the collector."""

    def __init__(self, collector: Collector, level: int = logging.NOTSET) -> None:
        super().__init__(level)
        self.collector = collector

    def emit(self, record: logging.LogRecord) -> None:
        try:
            message = record.getMessage()
            has_exc = bool(record.exc_info and record.exc_info[0] is not None)
            if has_exc and _TRACEBACK_MARKER not in message:
                # Sources like loguru pre-format the traceback into the message;
                # never paste a second one.
                message += "\n" + "".join(
                    traceback.format_exception(*record.exc_info)
                )
            is_error = record.levelno >= logging.ERROR and has_exc
            data: dict[str, Any] = {
                "logger": record.name,
                "pathname": record.pathname,
                "lineno": record.lineno,
                "func": record.funcName,
            }
            if has_exc:
                exc_type = record.exc_info[0]  # type: ignore[index]
                exc_name = getattr(exc_type, "__name__", str(exc_type))
                data["exc_type"] = exc_name
                data["signature"] = signature(
                    exc_name, record.pathname, record.lineno
                )
            self.collector.emit(
                {
                    "type": "error" if is_error else "log",
                    "level": record.levelname,
                    "message": message[:_MAX_MESSAGE],
                    "trace_id": current_trace_id.get(),
                    "data": data,
                }
            )
        except Exception:
            self.handleError(record)


Excepthook = Callable[
    [type[BaseException], BaseException, TracebackType | None], Any
]


def install_excepthook(collector: Collector) -> Excepthook:
    """Capture uncaught exceptions, then chain to the previous hook."""
    previous = sys.excepthook

    def hook(
        exc_type: type[BaseException],
        exc_value: BaseException,
        exc_tb: TracebackType | None,
    ) -> Any:
        try:
            exc_name = getattr(exc_type, "__name__", str(exc_type))
            sig, _, _ = from_traceback(exc_name, exc_tb)
            collector.emit(
                {
                    "type": "error",
                    "level": "CRITICAL",
                    "message": "".join(
                        traceback.format_exception(exc_type, exc_value, exc_tb)
                    )[:_MAX_MESSAGE],
                    "trace_id": current_trace_id.get(),
                    "data": {
                        "origin": "excepthook",
                        "exc_type": exc_name,
                        "signature": sig,
                    },
                }
            )
        finally:
            return previous(exc_type, exc_value, exc_tb)

    sys.excepthook = hook
    return previous
