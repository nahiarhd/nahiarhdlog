"""Read API over storage: validated filters + pagination.

Framework-agnostic: this module must never import FastAPI/Starlette.
This is the API the dashboard (and user code) reads through.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .postgres import PostgresStorage
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


def search_logs(storage: SQLiteStorage | PostgresStorage, filt: LogFilter) -> list[dict[str, Any]]:
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


def count_logs(storage: SQLiteStorage | PostgresStorage, filt: LogFilter) -> int:
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


def get_event(storage: SQLiteStorage | PostgresStorage, event_id: int) -> dict[str, Any] | None:
    return storage.get(int(event_id))


def top_errors(
    storage: SQLiteStorage | PostgresStorage, since: float | None = None, limit: int = 20
) -> list[dict[str, Any]]:
    return storage.top_signatures(since=since, limit=limit)


def get_trace(
    storage: SQLiteStorage | PostgresStorage, trace_id: str, limit: int = 500
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


def summarize_trace(events: list[dict[str, Any]]) -> dict[str, Any]:
    """Compute aggregate execution and AI metrics across all events in a trace."""
    root_event = None
    min_ts = None
    max_end_ts = None
    span_count = 0
    error_count = 0
    total_tokens = 0
    prompt_tokens = 0
    completion_tokens = 0
    models_used: list[str] = []
    tool_calls_count = 0

    for e in events:
        t = e.get("type")
        data = e.get("data") or {}
        ts = float(e.get("ts", 0))
        dur_ms = float(data.get("duration_ms") or 0)
        end_ts = ts + (dur_ms / 1000.0)

        if min_ts is None or ts < min_ts:
            min_ts = ts
        if max_end_ts is None or end_ts > max_end_ts:
            max_end_ts = end_ts

        if t == "request" and root_event is None:
            root_event = e
        elif t == "span":
            span_count += 1

        if (
            t == "error"
            or e.get("level") == "CRITICAL"
            or data.get("status") == "error"
        ):
            error_count += 1

        # AI statistics
        if "total_tokens" in data and data["total_tokens"] is not None:
            total_tokens += int(data["total_tokens"])
        if "prompt_tokens" in data and data["prompt_tokens"] is not None:
            prompt_tokens += int(data["prompt_tokens"])
        if "completion_tokens" in data and data["completion_tokens"] is not None:
            completion_tokens += int(data["completion_tokens"])
        if "model" in data and data["model"] and data["model"] not in models_used:
            models_used.append(data["model"])
        if "tool_calls" in data and isinstance(data["tool_calls"], list):
            tool_calls_count += len(data["tool_calls"])

    if root_event and root_event.get("data", {}).get("duration_ms") is not None:
        total_duration_ms = float(root_event["data"]["duration_ms"])
    elif min_ts is not None and max_end_ts is not None:
        total_duration_ms = round((max_end_ts - min_ts) * 1000.0, 3)
    else:
        total_duration_ms = 0.0

    return {
        "total_duration_ms": total_duration_ms,
        "event_count": len(events),
        "span_count": span_count,
        "error_count": error_count,
        "start_ts": min_ts,
        "has_ai": bool(
            total_tokens
            or models_used
            or tool_calls_count
            or any(
                e.get("data", {}).get("span_type")
                in ("llm", "tool", "embedding", "agent")
                for e in events
            )
        ),
        "ai_summary": {
            "total_tokens": total_tokens,
            "prompt_tokens": prompt_tokens,
            "completion_tokens": completion_tokens,
            "models": models_used,
            "tool_calls_count": tool_calls_count,
        },
    }

