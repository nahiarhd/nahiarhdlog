import sqlite3
import time

import pytest

from nahiarhdLOG.collector import Collector
from nahiarhdLOG.query import LogFilter, count_logs, get_event, search_logs
from nahiarhdLOG.storage import SQLiteStorage


@pytest.fixture()
def storage(tmp_path):
    s = SQLiteStorage(str(tmp_path / "t.db"))
    yield s
    s.close()


def _event(message="m", **kw):
    e = {"type": "log", "level": "INFO", "message": message, "trace_id": None, "data": {}}
    e.update(kw)
    return e


def test_insert_and_search_roundtrip(storage):
    storage.insert_many([_event("alpha beta"), _event("gamma")])
    assert storage.count(text="alpha") == 1
    rows = storage.search(text="beta")
    assert [r["message"] for r in rows] == ["alpha beta"]


def test_fts_special_characters_do_not_crash(storage):
    storage.insert_many([_event('weird "quoted" (text) AND OR *')])
    rows = storage.search(text='weird "quoted"')
    assert len(rows) == 1


def test_filters_and_pagination(storage):
    for i in range(10):
        storage.insert_many(
            [_event(f"msg-{i}", level="INFO" if i % 2 else "ERROR", trace_id="t1")]
        )
    assert storage.count(level="ERROR") == 5
    assert storage.count(trace_id="t1") == 10
    page1 = storage.search(level="INFO", limit=2, offset=0)
    page2 = storage.search(level="INFO", limit=2, offset=2)
    assert [r["id"] for r in page1] != [r["id"] for r in page2]
    assert len(page1) == 2
    over = storage.search(limit=10_000)
    assert len(over) == 10, "limit must be clamped, not crash"


def test_time_filters(storage):
    now = time.time()
    storage.insert_many([_event("old", ts=now - 100), _event("new", ts=now)])
    assert storage.count(since=now - 10) == 1
    assert storage.count(until=now - 10) == 1


def test_get_and_missing(storage):
    storage.insert_many([_event("findme")])
    row = storage.search(text="findme")[0]
    assert storage.get(row["id"])["message"] == "findme"
    assert storage.get(999_999) is None


def test_purge_removes_old_events(tmp_path):
    s = SQLiteStorage(str(tmp_path / "t.db"), retention_days=1)
    try:
        now = time.time()
        s.insert_many([_event("old", ts=now - 3 * 86400), _event("new", ts=now)])
        assert s.purge() == 1
        assert s.count() == 1
    finally:
        s.close()


def test_expected_indexes_exist(storage):
    conn = sqlite3.connect(storage.path)
    try:
        names = {
            r[0]
            for r in conn.execute(
                "SELECT name FROM sqlite_master WHERE type='index'"
            ).fetchall()
        }
    finally:
        conn.close()
    for expected in ("idx_events_ts", "idx_events_level", "idx_events_trace", "idx_events_type"):
        assert expected in names


def test_query_layer_normalizes_filter(storage):
    storage.insert_many([_event("q1"), _event("q2")])
    normalized = LogFilter(text="", limit=0, offset=-5).normalized()
    assert normalized.text is None
    assert normalized.limit == 1
    assert normalized.offset == 0
    rows = search_logs(storage, LogFilter())
    assert len(rows) == 2
    assert count_logs(storage, LogFilter()) == 2
    assert get_event(storage, rows[0]["id"])["message"].startswith("q")


def test_collector_bounded_queue_drops_and_counts(tmp_path):
    c = Collector(str(tmp_path / "t.db"), queue_size=4)
    try:
        accepted = sum(1 for i in range(10) if c.emit(_event(f"e{i}")))
        assert accepted <= 4
        assert c.dropped == 10 - accepted
    finally:
        c.stop()


def test_collector_start_stop_flushes(tmp_path):
    c = Collector(str(tmp_path / "t.db")).start()
    c.emit(_event("persisted"))
    assert c.flush()
    c.stop()
    s = SQLiteStorage(str(tmp_path / "t.db"))
    try:
        assert s.count(text="persisted") == 1
    finally:
        s.close()
