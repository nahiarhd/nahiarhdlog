"""Read API over storage: validated filters + pagination.

Framework-agnostic: this module must never import FastAPI/Starlette.
This is the API the dashboard (and user code) reads through.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .storage import SQLiteStorage

_MAX_LIMIT = 1000


@dataclass(frozen=True)
class LogFilter:
    text: str | None = None
    level: str | list[str] | None = None
    event_type: str | None = None
    trace_id: str | None = None
    signature: str | None = None
    since: float | None = None
    until: float | None = None
    limit: int = 100
    offset: int = 0

    def normalized(self) -> LogFilter:
        return LogFilter(
            text=self.text or None,
            level=self.level,
            event_type=self.event_type,
            trace_id=self.trace_id,
            signature=self.signature or None,
            since=self.since,
            until=self.until,
            limit=max(1, min(int(self.limit), _MAX_LIMIT)),
            offset=max(0, int(self.offset)),
        )


def search_logs(storage: SQLiteStorage, filt: LogFilter) -> list[dict[str, Any]]:
    f = filt.normalized()
    return storage.search(
        text=f.text,
        level=f.level,
        event_type=f.event_type,
        trace_id=f.trace_id,
        signature=f.signature,
        since=f.since,
        until=f.until,
        limit=f.limit,
        offset=f.offset,
    )


def count_logs(storage: SQLiteStorage, filt: LogFilter) -> int:
    f = filt.normalized()
    return storage.count(
        text=f.text,
        level=f.level,
        event_type=f.event_type,
        trace_id=f.trace_id,
        signature=f.signature,
        since=f.since,
        until=f.until,
    )


def get_event(storage: SQLiteStorage, event_id: int) -> dict[str, Any] | None:
    return storage.get(int(event_id))


def top_errors(
    storage: SQLiteStorage, since: float | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    return storage.top_signatures(since=since, limit=limit)


def get_trace(
    storage: SQLiteStorage, trace_id: str, limit: int = 500
) -> list[dict[str, Any]]:
    """All events of one trace, oldest first (v1: flat, single-service).

    A unique prefix (≥8 chars) resolves to the full id so a truncated
    copy from the table still works.
    """
    rows = search_logs(storage, LogFilter(trace_id=trace_id, limit=limit))
    if not rows:
        resolved = storage.resolve_trace_id(trace_id)
        if resolved and resolved != trace_id:
            rows = search_logs(storage, LogFilter(trace_id=resolved, limit=limit))
    return list(reversed(rows))
