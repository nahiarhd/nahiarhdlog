import inspect
import sqlite3
import threading
import time

import pytest

from nahiarhdLOG.adapters.fastapi import observe
from nahiarhdLOG.collector import DEFAULT_DB_PATH, Collector
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


def _break_fts(storage):
    """Fault injection: drop the FTS index so MATCH raises OperationalError."""
    storage._conn.execute("DROP TABLE events_fts")


def test_fts_fallback_preserves_all_filters(storage):
    # Regression: when MATCH failed, the LIKE fallback dropped every other
    # filter (type/level/signature/...) and returned a wrong superset.
    storage.insert_many(
        [
            _event("boom marker one", type="error", level="CRITICAL",
                   trace_id="t1", data={"signature": "E@a.py:1"}),
            _event("boom marker two", type="request", level=None, trace_id="t1"),
            _event("boom marker three", type="log", level="INFO", trace_id="t2"),
        ]
    )
    _break_fts(storage)
    rows = storage.search(text="marker", event_type="error")
    assert [r["type"] for r in rows] == ["error"]
    assert storage.count(text="marker", event_type="error") == 1
    assert storage.count(text="marker", level="INFO") == 1
    assert storage.count(text="marker", trace_id="t2") == 1
    assert storage.count(text="marker", signature="E@a.py:1") == 1
    assert storage.search(text="marker", event_type="error", level="INFO") == []


def test_fts_fallback_matches_primary_results(storage):
    storage.insert_many(
        [
            _event("alpha needle beta", type="error", level="CRITICAL"),
            _event("gamma needle delta", type="log", level="INFO"),
            _event("no match here", type="log", level="INFO"),
        ]
    )
    before = [r["id"] for r in storage.search(text="needle")]
    _break_fts(storage)
    after = [r["id"] for r in storage.search(text="needle")]
    assert after == before
    assert storage.count(text="needle") == 2


class _FlakyConn:
    """Raises one transient lock error, then delegates to the real connection."""

    def __init__(self, real):
        self._real = real
        self.calls = 0

    def execute(self, sql, *args):
        self.calls += 1
        if self.calls == 1:
            raise sqlite3.OperationalError("database is locked")
        return self._real.execute(sql, *args)

    def __getattr__(self, name):
        return getattr(self._real, name)


def test_text_search_reraises_lock_errors(storage):
    # A transient lock must surface as an error (caller retries), never
    # silently degrade into different results.
    storage.insert_many([_event("lockme")])
    flaky = _FlakyConn(storage._conn)
    storage._conn = flaky
    with pytest.raises(sqlite3.OperationalError):
        storage.search(text="lockme")
    flaky.calls = 0
    with pytest.raises(sqlite3.OperationalError):
        storage.count(text="lockme")


def test_repeated_text_search_is_deterministic(storage):
    storage.insert_many(
        [
            _event(f"trace feebb235-6de1 event {i}", trace_id="t1")
            for i in range(5)
        ]
        + [_event("unrelated", trace_id="t2")]
    )
    runs = [
        tuple(r["id"] for r in storage.search(text="feebb235-6de1"))
        for _ in range(5)
    ]
    assert all(r == runs[0] for r in runs) and len(runs[0]) == 5


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


def test_storage_creates_missing_parent_dirs(tmp_path):
    nested = tmp_path / "sub" / "dir" / "t.db"
    s = SQLiteStorage(str(nested))
    try:
        s.insert_many([_event("nested")])
        assert s.count(text="nested") == 1
    finally:
        s.close()
    assert nested.exists()


def test_default_db_path_is_dot_directory():
    assert DEFAULT_DB_PATH == ".nahiarhdlog/nahiarhdlog.db"
    params = inspect.signature(Collector.__init__).parameters
    assert params["db_path"].default is DEFAULT_DB_PATH
    params = inspect.signature(observe).parameters
    assert params["db_path"].default is DEFAULT_DB_PATH


class _FakeStorage:
    """Minimal duck-typed backend proving the Collector storage seam."""

    def __init__(self) -> None:
        self.events: list = []
        self.closed = False

    def insert_many(self, events) -> int:
        events = list(events)
        self.events.extend(events)
        return len(events)

    def close(self) -> None:
        self.closed = True


def test_collector_accepts_custom_storage():
    fake = _FakeStorage()
    c = Collector(storage=fake).start()
    c.emit(_event("via-fake"))
    assert c.flush()
    c.stop()
    assert [e["message"] for e in fake.events] == ["via-fake"]
    assert fake.closed


def test_storage_insert_retry_on_lock(tmp_path):
    db_path = str(tmp_path / "lock_test.db")
    s = SQLiteStorage(db_path, timeout=1.0)
    try:
        conn2 = sqlite3.connect(
            db_path, timeout=1.0, check_same_thread=False, isolation_level=None
        )
        try:
            conn2.execute("BEGIN IMMEDIATE")

            def release_lock():
                time.sleep(0.08)
                conn2.execute("COMMIT")

            t = threading.Thread(target=release_lock)
            t.start()
            count = s.insert_many([_event("concurrent_msg")])
            t.join()
            assert count == 1
            assert s.count(text="concurrent_msg") == 1
        finally:
            conn2.close()
    finally:
        s.close()


class _FailingStorage(_FakeStorage):
    def __init__(self) -> None:
        super().__init__()
        self.should_fail = True

    def insert_many(self, events):
        if self.should_fail:
            raise sqlite3.OperationalError("database is locked")
        return super().insert_many(events)


def test_collector_resilient_to_storage_crash():
    storage = _FailingStorage()
    c = Collector(storage=storage).start()
    try:
        c.emit(_event("fail_me"))
        c.flush()
        assert c._thread.is_alive()
        assert c.dropped == 1

        storage.should_fail = False
        c.emit(_event("recover_me"))
        c.flush()
        assert c._thread.is_alive()
        assert any(e["message"] == "recover_me" for e in storage.events)
    finally:
        c.stop()


def test_handler_ignores_internal_nahiarhdlog_logs():
    import logging
    from nahiarhdLOG.handler import NahiarhdHandler

    fake = _FakeStorage()
    c = Collector(storage=fake)
    handler = NahiarhdHandler(c)
    record = logging.LogRecord(
        name="nahiarhdLOG.collector",
        level=logging.WARNING,
        pathname="collector.py",
        lineno=100,
        msg="internal warning",
        args=(),
        exc_info=None,
    )
    handler.emit(record)
    assert c.queued == 0

