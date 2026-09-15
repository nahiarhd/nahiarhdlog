import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nahiarhdLOG import observe


@pytest.fixture()
def app_and_collector(tmp_path):
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {"ok": True}

    @app.get("/fail")
    def fail():
        raise RuntimeError("fail-marker")

    collector = observe(app, db_path=str(tmp_path / "t.db"))
    with TestClient(app) as client:
        yield client, collector


def test_incoming_traceparent_is_reused(app_and_collector):
    client, collector = app_and_collector
    incoming = "00-4bf92f3577b34da6a3ce929d0e0e4736-00f067aa0ba902b7-01"
    r = client.get("/ping", headers={"traceparent": incoming})
    assert r.status_code == 200
    outgoing = r.headers.get("traceparent")
    assert outgoing is not None
    assert outgoing.startswith("00-4bf92f3577b34da6a3ce929d0e0e4736-")
    assert outgoing != incoming  # parent-id is this hop, per the spec
    assert collector.flush()
    rows = collector.storage.search(event_type="request")
    row = [e for e in rows if e["data"].get("path") == "/ping"][-1]
    assert row["trace_id"] == "4bf92f3577b34da6a3ce929d0e0e4736"
    assert row["data"]["parent_id"] == "00f067aa0ba902b7"


def test_invalid_traceparent_starts_a_new_trace(app_and_collector):
    client, collector = app_and_collector
    r = client.get("/ping", headers={"traceparent": "garbage"})
    assert r.status_code == 200
    outgoing = r.headers["traceparent"]
    assert outgoing.startswith("00-")
    assert collector.flush()
    rows = collector.storage.search(event_type="request")
    row = [e for e in rows if e["data"].get("path") == "/ping"][-1]
    assert row["trace_id"] == outgoing.split("-")[1]
    assert "parent_id" not in row["data"]


def test_request_is_logged(app_and_collector):
    client, collector = app_and_collector
    r = client.get("/ping")
    assert r.status_code == 200
    assert collector.flush()
    rows = collector.storage.search(event_type="request")
    assert len(rows) == 1
    row = rows[0]
    assert row["data"]["path"] == "/ping"
    assert row["data"]["status"] == 200
    assert row["data"]["duration_ms"] >= 0
    assert row["trace_id"]


def test_request_captures_client_and_user_agent(app_and_collector):
    client, collector = app_and_collector
    r = client.get("/ping?x=1", headers={"user-agent": "probe-ua/1.0"})
    assert r.status_code == 200
    assert collector.flush()
    rows = collector.storage.search(event_type="request")
    row = [e for e in rows if e["data"].get("query") == "x=1"][0]
    assert row["data"]["client"] == "testclient"
    assert row["data"]["user_agent"] == "probe-ua/1.0"


def test_exception_yields_error_and_500_request(app_and_collector):
    client, collector = app_and_collector
    with pytest.raises(RuntimeError):
        client.get("/fail")
    assert collector.flush()
    errors = collector.storage.search(event_type="error")
    assert any("fail-marker" in e["message"] for e in errors)
    reqs = [e for e in collector.storage.search(event_type="request") if e["data"].get("status") == 500]
    assert reqs, "expected a 500 request event"
    trace_ids = {e["trace_id"] for e in errors} | {e["trace_id"] for e in reqs}
    assert len(trace_ids) == 1, "error and request must share one trace_id"


def test_skip_prefixes_passthrough_without_logging(tmp_path):
    from nahiarhdLOG.collector import Collector
    from nahiarhdLOG.middleware import LoggingMiddleware

    collector = Collector(str(tmp_path / "t.db")).start()
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {"ok": True}

    @app.get("/nahiarhdlog/api/health")
    def health():
        return {"ok": True}

    app.add_middleware(
        LoggingMiddleware, collector=collector, skip_prefixes=("/nahiarhdlog",)
    )
    try:
        with TestClient(app) as client:
            assert client.get("/ping").status_code == 200
            assert client.get("/nahiarhdlog/api/health").status_code == 200
        assert collector.flush()
        rows = collector.storage.search(event_type="request")
        assert [r["data"]["path"] for r in rows] == ["/ping"]
    finally:
        collector.stop()


def test_sampling_drops_ok_requests_but_keeps_errors(tmp_path):
    from nahiarhdLOG.collector import Collector
    from nahiarhdLOG.middleware import LoggingMiddleware

    collector = Collector(str(tmp_path / "t.db")).start()
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {"ok": True}

    @app.get("/fail")
    def fail():
        raise RuntimeError("sample-marker")

    app.add_middleware(LoggingMiddleware, collector=collector, sample_rate=0.0)
    try:
        with TestClient(app) as client:
            client.get("/ping")
            with pytest.raises(RuntimeError):
                client.get("/fail")
        assert collector.flush()
        assert collector.storage.search(event_type="request", text="/ping") == []
        assert collector.storage.count(text="sample-marker") >= 1
    finally:
        collector.stop()
