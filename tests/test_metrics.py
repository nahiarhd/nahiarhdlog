import time

import pytest

from nahiarhdLOG.metrics import quantile, request_stats, timeseries
from nahiarhdLOG.query import get_trace
from nahiarhdLOG.storage import SQLiteStorage


@pytest.fixture()
def storage(tmp_path):
    s = SQLiteStorage(str(tmp_path / "t.db"))
    yield s
    s.close()


def _request(ts, status=200, duration_ms=10.0, path="/x"):
    return {
        "ts": ts,
        "type": "request",
        "level": None,
        "message": f"GET {path}",
        "trace_id": None,
        "data": {"method": "GET", "path": path, "status": status, "duration_ms": duration_ms},
    }


def test_quantile_nearest_rank():
    assert quantile([], 0.5) is None
    assert quantile([10, 20, 30, 40], 0.50) == 20
    assert quantile([10, 20, 30, 40], 0.95) == 40
    assert quantile([5], 0.99) == 5


def test_request_stats_exact(storage):
    now = time.time()
    storage.insert_many(
        [
            _request(now - 10, 200, 10.0),
            _request(now - 9, 200, 20.0),
            _request(now - 8, 500, 30.0),
            _request(now - 7, 200, 40.0),
            _request(now - 10_000, 200, 1.0),  # outside the window
        ]
    )
    stats = request_stats(storage, window_seconds=300, now=now)
    assert stats["count"] == 4
    assert stats["errors"] == 1
    assert stats["error_rate"] == pytest.approx(0.25)
    assert stats["rps"] == pytest.approx(4 / 300)
    assert stats["p50_ms"] == 20.0
    assert stats["p95_ms"] == 40.0


def test_request_stats_empty(storage):
    stats = request_stats(storage, window_seconds=60)
    assert stats["count"] == 0
    assert stats["p50_ms"] is None
    assert stats["error_rate"] == 0.0


def test_timeseries_buckets(storage):
    now = time.time()
    storage.insert_many(
        [
            _request(now - 90, 200, 10.0),
            _request(now - 40, 500, 30.0),
        ]
    )
    series = timeseries(storage, window_seconds=100, buckets=2, now=now)
    assert [b["count"] for b in series] == [1, 1]
    assert [b["errors"] for b in series] == [0, 1]
    assert [b["avg_ms"] for b in series] == [10.0, 30.0]
    assert series[0]["ts"] < series[1]["ts"]


def test_get_trace_oldest_first(storage):
    now = time.time()
    tid = "ab" * 16
    storage.insert_many(
        [
            {"ts": now, "type": "request", "message": "r", "trace_id": tid, "data": {}},
            {"ts": now + 1, "type": "log", "message": "l", "trace_id": tid, "data": {}},
            {"ts": now + 2, "type": "error", "message": "e", "trace_id": tid, "data": {}},
            {"ts": now + 3, "type": "log", "message": "other", "trace_id": "zz", "data": {}},
        ]
    )
    trace = get_trace(storage, tid)
    assert [e["message"] for e in trace] == ["r", "l", "e"]
