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
    assert errors[0]["data"]["exc_type"] == "RuntimeError"
    assert errors[0]["data"]["exc_message"] == "fail-marker"
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


def test_request_and_response_body_captured(tmp_path):
    app = FastAPI()

    @app.post("/api/proxy/v1/responses")
    def proxy(payload: dict):
        return {"result": f"hello {payload.get('prompt')}", "model": "test-llm"}

    collector = observe(app, db_path=str(tmp_path / "t.db"), capture_body=True)
    with TestClient(app) as client:
        res = client.post(
            "/api/proxy/v1/responses",
            json={"prompt": "world", "max_tokens": 100},
            headers={"x-custom-header": "test-val"},
        )
        assert res.status_code == 200
        assert res.json()["result"] == "hello world"
        assert collector.flush()
        rows = collector.storage.search(event_type="request")
        row = [r for r in rows if r["data"].get("path") == "/api/proxy/v1/responses"][0]
        data = row["data"]
        assert data["request_body"] == {"prompt": "world", "max_tokens": 100}
        assert data["response_body"] == {
            "result": "hello world",
            "model": "test-llm",
        }
        assert "request_headers" in data
        assert data["request_headers"]["x-custom-header"] == "test-val"
        assert "response_headers" in data


def test_sensitive_headers_and_body_redacted(tmp_path):
    app = FastAPI()

    @app.post("/login")
    def login(payload: dict):
        return {"status": "ok", "api_key": "secret_key_val_123"}

    collector = observe(app, db_path=str(tmp_path / "t.db"), capture_body=True)
    with TestClient(app) as client:
        res = client.post(
            "/login",
            json={"username": "alice", "password": "supersecretpassword"},
            headers={"authorization": "Bearer secret-token-xyz"},
        )
        assert res.status_code == 200
        assert collector.flush()
        row = collector.storage.search(event_type="request")[0]
        data = row["data"]
        assert data["request_headers"]["authorization"] == "[REDACTED]"
        assert data["request_body"]["password"] == "[REDACTED]"
        assert data["request_body"]["username"] == "alice"
        assert data["response_body"]["api_key"] == "[REDACTED]"


def test_body_size_truncation(tmp_path):
    app = FastAPI()

    @app.post("/big")
    def big(payload: dict):
        return {"echo": payload.get("data")}

    collector = observe(
        app, db_path=str(tmp_path / "t.db"), capture_body=True, max_body_size=50
    )
    with TestClient(app) as client:
        res = client.post("/big", json={"data": "x" * 200})
        assert res.status_code == 200
        assert collector.flush()
        row = collector.storage.search(event_type="request")[0]
        data = row["data"]
        assert data.get("request_body") is not None
        req_body = data["request_body"]
        assert isinstance(req_body, str) or (
            isinstance(req_body, dict) and req_body.get("_truncated")
        )

