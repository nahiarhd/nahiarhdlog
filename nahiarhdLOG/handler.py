"""Capture stdlib `logging` records and uncaught exceptions.

Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import logging
import sys
import threading
import traceback
from types import TracebackType
from typing import Any, Callable

from .collector import Collector
from .grouping import from_traceback, signature
from .middleware import current_trace_id

_MAX_MESSAGE = 8000
# stdlib and loguru tracebacks both start with this header line.
_TRACEBACK_MARKER = "Traceback (most recent call last)"
# LogRecord fields that are not `extra=`. Source:
# https://docs.python.org/3.12/library/logging.html#logrecord-attributes
_RECORD_BUILTIN = frozenset(
    {
        "args",
        "asctime",
        "created",
        "exc_info",
        "exc_text",
        "filename",
        "funcName",
        "levelname",
        "levelno",
        "lineno",
        "message",
        "module",
        "msecs",
        "msg",
        "name",
        "pathname",
        "process",
        "processName",
        "relativeCreated",
        "stack_info",
        "taskName",
        "thread",
        "threadName",
    }
)


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
            for key, value in record.__dict__.items():
                if (
                    key in _RECORD_BUILTIN
                    or key in data
                    or key.startswith("_")
                    or not isinstance(value, (str, int, float, bool, type(None)))
                ):
                    continue
                data[key] = value
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


def ensure_handler(collector: Collector, level: int = logging.NOTSET) -> None:
    """Attach a `NahiarhdHandler` to the root logger if this collector lacks one."""
    root = logging.getLogger()
    for handler in root.handlers:
        if isinstance(handler, NahiarhdHandler) and handler.collector is collector:
            handler.setLevel(level)
            return
    root.addHandler(NahiarhdHandler(collector, level=level))


Excepthook = Callable[
    [type[BaseException], BaseException, TracebackType | None], Any
]


def _emit_uncaught(
    collector: Collector,
    exc_type: type[BaseException] | None,
    exc_value: BaseException | None,
    exc_tb: TracebackType | None,
    origin: str,
) -> None:
    if exc_type is None:
        return
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
                "origin": origin,
                "exc_type": exc_name,
                "signature": sig,
            },
        }
    )


def install_excepthook(collector: Collector) -> Excepthook:
    """Capture uncaught exceptions in the main thread and in `threading.Thread`.

    `sys.excepthook` does not see `Thread.run` failures; `threading.excepthook`
    does (Python 3.8+). Source:
    https://docs.python.org/3.12/library/threading.html#threading.excepthook
    """
    previous = sys.excepthook
    previous_thread = threading.excepthook

    def hook(
        exc_type: type[BaseException],
        exc_value: BaseException,
        exc_tb: TracebackType | None,
    ) -> Any:
        try:
            _emit_uncaught(collector, exc_type, exc_value, exc_tb, "excepthook")
        finally:
            return previous(exc_type, exc_value, exc_tb)

    def thread_hook(args: threading.ExceptHookArgs) -> None:
        # Spec: SystemExit from a thread is silently ignored by the default hook.
        if args.exc_type is SystemExit:
            previous_thread(args)
            return
        try:
            _emit_uncaught(
                collector,
                args.exc_type,
                args.exc_value,
                args.exc_traceback,
                "thread_excepthook",
            )
        finally:
            previous_thread(args)

    sys.excepthook = hook
    threading.excepthook = thread_hook
    return previous
