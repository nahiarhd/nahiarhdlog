"""Metrics computed from stored request events.

Framework-agnostic: this module must never import FastAPI/Starlette.
No separate collector: metrics derive from the same request events the
middleware already stores, so they can never drift from the logs.
"""

from __future__ import annotations

import math
import time
from typing import Any

from .storage import SQLiteStorage


def quantile(sorted_values: list[float], q: float) -> float | None:
    """Nearest-rank quantile over pre-sorted values. Returns None when empty."""
    if not sorted_values:
        return None
    rank = max(1, math.ceil(q * len(sorted_values)))
    return sorted_values[rank - 1]


def request_stats(
    storage: SQLiteStorage, window_seconds: float = 300.0, now: float | None = None
) -> dict[str, Any]:
    """Aggregate RPS / latency / errors over the trailing window."""
    now = time.time() if now is None else now
    rows = storage.fetch_requests(since=now - window_seconds, until=now)
    durations = sorted(r["duration_ms"] for r in rows if r["duration_ms"] is not None)
    errors = sum(1 for r in rows if (r["status"] or 0) >= 500)
    count = len(rows)
    return {
        "window_seconds": window_seconds,
        "count": count,
        "rps": count / window_seconds if window_seconds > 0 else 0.0,
        "errors": errors,
        "error_rate": errors / count if count else 0.0,
        "p50_ms": quantile(durations, 0.50),
        "p95_ms": quantile(durations, 0.95),
    }


def timeseries(
    storage: SQLiteStorage,
    window_seconds: float = 3600.0,
    buckets: int = 60,
    now: float | None = None,
) -> list[dict[str, Any]]:
    """Bucketed counts/errors/avg-latency for dashboard charts."""
    now = time.time() if now is None else now
    buckets = max(1, int(buckets))
    width = window_seconds / buckets if window_seconds > 0 else 1.0
    start = now - window_seconds
    sums = [0.0] * buckets
    counts = [0] * buckets
    errors = [0] * buckets
    for r in storage.fetch_requests(since=start, until=now):
        idx = min(buckets - 1, int((r["ts"] - start) / width))
        counts[idx] += 1
        if (r["status"] or 0) >= 500:
            errors[idx] += 1
        if r["duration_ms"] is not None:
            sums[idx] += r["duration_ms"]
    return [
        {
            "ts": start + i * width,
            "count": counts[i],
            "errors": errors[i],
            "avg_ms": (sums[i] / counts[i]) if counts[i] else None,
        }
        for i in range(buckets)
    ]
