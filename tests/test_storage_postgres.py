"""Postgres backend: shared history for multi-replica deployments.

Live tests need a reachable Postgres; point NAHILOG_TEST_PG_URL at an
admin database (CI provides one, see .github/workflows/ci.yml):

    NAHILOG_TEST_PG_URL=postgresql://user:pass@localhost:5432/postgres \
        pytest tests/test_storage_postgres.py

Without the variable the live tests skip; backend selection and the
missing-driver error are covered by tests that need no server.
"""

import os
from urllib.parse import urlsplit, urlunsplit

import pytest

import nahiarhdLOG
from nahiarhdLOG.collector import Collector
from nahiarhdLOG.metrics import request_stats
from nahiarhdLOG.postgres import PostgresStorage, _escape_like
from nahiarhdLOG.query import LogFilter, get_trace, search_logs
from nahiarhdLOG.storage import SQLiteStorage

_TEST_DB = "nahiarhdlog_test"


def _replace_dbname(dsn, name):
    parts = urlsplit(dsn)
    return urlunsplit((parts.scheme, parts.netloc, "/" + name, parts.query, parts.fragment))


@pytest.fixture(scope="session")
def pg_dsn():
    psycopg = pytest.importorskip("psycopg")
    admin = os.environ.get("NAHILOG_TEST_PG_URL")
    if not admin:
        pytest.skip("NAHILOG_TEST_PG_URL not set (needs a Postgres server)")
    dsn = _replace_dbname(admin, _TEST_DB)
    conn = psycopg.connect(admin, autocommit=True)
    try:
        conn.execute(f"DROP DATABASE IF EXISTS {_TEST_DB}")
        conn.execute(f"CREATE DATABASE {_TEST_DB}")
    finally:
        conn.close()
    yield dsn
    conn = psycopg.connect(admin, autocommit=True)
    try:
        conn.execute(f"DROP DATABASE IF EXISTS {_TEST_DB}")
    finally:
        conn.close()


@pytest.fixture()
def storage(pg_dsn):
    s = PostgresStorage(pg_dsn)
    s._conn.execute("TRUNCATE nahiarhdlog_events")
    s._conn.commit()
    yield s
    s.close()


def _event(message="m", **kw):
    e = {"type": "log", "level": "INFO", "message": message, "trace_id": None, "data": {}}
    e.update(kw)
    return e


# -- always-run: backend selection, no server needed -------------------------


def test_postgres_storage_is_exported():
    assert nahiarhdLOG.PostgresStorage is PostgresStorage


def test_collector_selects_postgres_for_postgresql_url(monkeypatch):
    seen = {}

    class Stub:
        def __init__(self, dsn, retention_days=7):
            seen["dsn"] = dsn
            seen["retention_days"] = retention_days

    monkeypatch.setattr("nahiarhdLOG.collector.PostgresStorage", Stub)
    collector = Collector("postgresql://db:5432/logs", retention_days=3)
    assert isinstance(collector.storage, Stub)
    assert seen == {"dsn": "postgresql://db:5432/logs", "retention_days": 3}


def test_collector_selects_postgres_for_postgres_scheme(monkeypatch):
    class Stub:
        def __init__(self, dsn, retention_days=7):
            pass

    monkeypatch.setattr("nahiarhdLOG.collector.PostgresStorage", Stub)
    collector = Collector("postgres://db:5432/logs")
    assert isinstance(collector.storage, Stub)


def test_collector_keeps_sqlite_for_paths(tmp_path):
    collector = Collector(str(tmp_path / "t.db"))
    try:
        assert isinstance(collector.storage, SQLiteStorage)
    finally:
        collector.storage.close()


def test_missing_driver_raises_helpful_error(monkeypatch):
    monkeypatch.setattr("nahiarhdLOG.postgres.psycopg", None)
    with pytest.raises(ImportError, match=r"pip install nahiarhdlog\[postgres\]"):
        PostgresStorage("postgresql://db:5432/logs")


def test_like_wildcards_are_escaped():
    assert _escape_like("100% sure_thing\\x") == "100\\% sure\\_thing\\\\x"


# -- live: behavioural contract ----------------------------------------------


def test_insert_and_search_roundtrip(storage):
    storage.insert_many([_event("alpha beta"), _event("gamma")])
    assert storage.count(text="alpha") == 1
    rows = storage.search(text="beta")
    assert [r["message"] for r in rows] == ["alpha beta"]


def test_text_search_is_case_insensitive(storage):
    storage.insert_many([_event("Alpha Beta")])
    assert storage.count(text="alpha") == 1
    assert storage.count(text="ALPHA") == 1


def test_text_wildcards_match_literally(storage):
    storage.insert_many(
        [_event("100% coverage"), _event("abc"), _event("axc"), _event("plain")]
    )
    assert storage.count(text="100%") == 1
    # Unescaped, "a_c" would match abc and axc; escaped it matches nothing.
    assert storage.count(text="a_c") == 0
    assert storage.count(text="_") == 0


def test_filters_combine(storage):
    storage.insert_many(
        [
            _event(
                "boom one",
                type="error",
                level="CRITICAL",
                trace_id="t1",
                data={"signature": "E@a.py:1"},
            ),
            _event("boom two", type="request", level=None, trace_id="t1"),
            _event("boom three", type="log", level="INFO", trace_id="t2"),
        ]
    )
    assert storage.count(text="boom", event_type="error") == 1
    assert storage.count(text="boom", level="INFO") == 1
    assert storage.count(level=["INFO", "CRITICAL"]) == 2
    assert storage.count(trace_id="t1") == 2
    assert storage.count(signature="E@a.py:1") == 1
    rows = storage.search(text="boom", event_type="error")
    assert [r["type"] for r in rows] == ["error"]


def test_since_until_limit_offset_and_order(storage):
    storage.insert_many([_event(f"m{i}", ts=1000.0 + i) for i in range(5)])
    assert storage.count(since=1002.0) == 3
    assert storage.count(until=1001.0) == 2
    rows = storage.search(limit=2)
    assert [r["message"] for r in rows] == ["m4", "m3"]
    rows = storage.search(limit=2, offset=2)
    assert [r["message"] for r in rows] == ["m2", "m1"]
    rows = storage.search()
    assert [r["message"] for r in rows] == ["m4", "m3", "m2", "m1", "m0"]


def test_data_roundtrips_as_dict(storage):
    storage.insert_many([_event("m", data={"a": 1, "b": [1, 2], "c": {"d": "e"}})])
    rows = storage.search()
    assert rows[0]["data"] == {"a": 1, "b": [1, 2], "c": {"d": "e"}}


def test_top_signatures(storage):
    storage.insert_many(
        [
            _event("e1", type="error", data={"signature": "SIG-A"}),
            _event("e2", type="error", data={"signature": "SIG-A"}),
            _event("e3", type="error", data={"signature": "SIG-B"}),
            _event("e4", type="error"),
            _event("r1", type="request"),
        ]
    )
    top = storage.top_signatures()
    by_sig = {t["signature"]: t["count"] for t in top}
    assert by_sig == {"SIG-A": 2, "(unknown)": 1, "SIG-B": 1}
    assert top[0]["signature"] == "SIG-A"
    assert top[0]["last_message"] in ("e1", "e2")


def test_resolve_trace_id(storage):
    storage.insert_many(
        [
            _event("a", trace_id="abcdef01-x"),
            _event("b", trace_id="abcdef02-y"),
            _event("c", trace_id="zzzzz999-q"),
        ]
    )
    assert storage.resolve_trace_id("abcdef01") == "abcdef01-x"
    assert storage.resolve_trace_id("zzzzz999") == "zzzzz999-q"
    assert storage.resolve_trace_id("abcdef") is None  # ambiguous
    assert storage.resolve_trace_id("abc") is None  # too short
    assert storage.resolve_trace_id("no-such-trace") is None


def test_get_and_missing(storage):
    storage.insert_many([_event("hello")])
    found = storage.search()[0]
    assert storage.get(found["id"])["message"] == "hello"
    assert storage.get(999_999_999) is None


def test_fetch_requests_returns_numbers(storage):
    import time

    now = time.time()
    storage.insert_many(
        [
            _event("r1", type="request", ts=now - 10,
                   data={"status": 200, "duration_ms": 12.5}),
            _event("r2", type="request", ts=now - 5,
                   data={"status": 500, "duration_ms": 40.0}),
            _event("plain log", type="log", ts=now - 1),
        ]
    )
    rows = storage.fetch_requests(since=now - 60, until=now)
    assert [(r["status"], r["duration_ms"]) for r in rows] == [(200, 12.5), (500, 40.0)]
    stats = request_stats(storage, window_seconds=60, now=now)
    assert stats["count"] == 2
    assert stats["errors"] == 1
    assert stats["p50_ms"] == 12.5


def test_trace_lookup_by_prefix(storage):
    storage.insert_many(
        [
            _event("step one", trace_id="trace-1234-abcd", ts=100.0),
            _event("step two", trace_id="trace-1234-abcd", ts=101.0),
        ]
    )
    events = get_trace(storage, "trace-1234")
    assert [e["message"] for e in events] == ["step one", "step two"]
    rows = search_logs(storage, LogFilter(trace_id="trace-1234-abcd"))
    assert len(rows) == 2


def test_purge_removes_only_old_rows(pg_dsn):
    import time

    old = time.time() - 8 * 86400
    s = PostgresStorage(pg_dsn, retention_days=7)
    try:
        s._conn.execute("TRUNCATE nahiarhdlog_events")
        s._conn.commit()
        s.insert_many([_event("old", ts=old), _event("new")])
        assert s.purge() == 1
        assert [r["message"] for r in s.search()] == ["new"]
    finally:
        s.close()


def test_purge_disabled_when_retention_nonpositive(pg_dsn):
    import time

    s = PostgresStorage(pg_dsn, retention_days=0)
    try:
        s._conn.execute("TRUNCATE nahiarhdlog_events")
        s._conn.commit()
        s.insert_many([_event("old", ts=time.time() - 30 * 86400)])
        assert s.purge() == 0
        assert s.count() == 1
    finally:
        s.close()


def test_two_connections_share_history(pg_dsn):
    """The replica scenario: writes on one connection read on another."""
    first = PostgresStorage(pg_dsn)
    second = PostgresStorage(pg_dsn)
    try:
        first._conn.execute("TRUNCATE nahiarhdlog_events")
        first._conn.commit()
        first.insert_many([_event("from-pod-a", trace_id="shared-trace-1")])
        assert second.count() == 1
        assert get_trace(second, "shared-trace-1")[0]["message"] == "from-pod-a"
    finally:
        first.close()
        second.close()


def test_recovers_after_connection_drop(storage):
    storage.insert_many([_event("before")])
    storage._conn.close()  # simulate a dropped connection / DB restart
    assert storage.count() == 1
    storage.insert_many([_event("after")])
    assert storage.count() == 2


def test_use_after_close_fails_fast(pg_dsn):
    s = PostgresStorage(pg_dsn)
    s.close()
    with pytest.raises(Exception, match="closed"):
        s.count()


def test_collector_end_to_end_over_postgres(pg_dsn):
    collector = Collector(pg_dsn)
    assert isinstance(collector.storage, PostgresStorage)
    collector.storage._conn.execute("TRUNCATE nahiarhdlog_events")
    collector.storage._conn.commit()
    collector.start()
    try:
        collector.emit(_event("via-collector", trace_id="collector-trace-1"))
        assert collector.flush()
        assert collector.storage.count() == 1
        assert get_trace(collector.storage, "collector-trace-1")[0]["message"] == (
            "via-collector"
        )
    finally:
        collector.stop()


def test_health_attributes(storage):
    assert storage.fts_available is False
    assert storage.retention_days == 7
