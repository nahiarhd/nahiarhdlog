import logging
import time

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from nahiarhdLOG import observe
from nahiarhdLOG.dashboard.router import create_dashboard_router

TOKEN = "s3cret-token"


@pytest.fixture()
def client_and_collector(tmp_path):
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {"ok": True}

    collector = observe(
        app, db_path=str(tmp_path / "t.db"), dashboard_token=TOKEN
    )
    now = time.time()
    collector.storage.insert_many(
        [
            {"ts": now - 3, "type": "log", "level": "INFO",
             "message": "hello world", "trace_id": "t1", "data": {}},
            {"ts": now - 2, "type": "request", "level": None,
             "message": "GET /ping", "trace_id": "t1",
             "data": {"method": "GET", "path": "/ping", "status": 200,
                      "duration_ms": 12.0}},
            {"ts": now - 1, "type": "error", "level": "CRITICAL",
             "message": "ValueError: bad\nTraceback...", "trace_id": "t2",
             "data": {"exc_type": "ValueError", "signature": "ValueError@x.py:9"}},
            {"ts": now, "type": "error", "level": "CRITICAL",
             "message": "ValueError: worse", "trace_id": "t3",
             "data": {"exc_type": "ValueError", "signature": "ValueError@x.py:9"}},
        ]
    )
    with TestClient(app) as client:
        yield client, collector


def test_missing_token_serves_setup_page(tmp_path):
    app = FastAPI()
    observe(app, db_path=str(tmp_path / "t.db"))
    with TestClient(app) as client:
        page = client.get("/nahiarhdlog/")
        assert page.status_code == 200
        assert "text/html" in page.headers["content-type"]
        assert page.headers["cache-control"] == "no-store"
        assert "dashboard_token" in page.text
        assert "/nahiarhdlog" in page.text
        # No data APIs without a token — and the old default prefix is gone.
        assert client.get("/nahiarhdlog/api/health").status_code == 404
        bare = client.get("/nahiarhdlog", follow_redirects=False)
        assert bare.status_code == 307
        assert bare.headers["location"] == "/nahiarhdlog/"
        assert client.get("/admin/logs/").status_code == 404


def test_missing_token_warns_at_startup(tmp_path, caplog):
    app = FastAPI()
    with caplog.at_level(logging.WARNING):
        observe(app, db_path=str(tmp_path / "t.db"))
    assert "dashboard_token" in caplog.text
    assert "/nahiarhdlog" in caplog.text


def test_page_without_token_returns_lock(client_and_collector):
    client, _ = client_and_collector
    r = client.get("/nahiarhdlog/")
    assert r.status_code == 401
    assert "text/html" in r.headers["content-type"]
    assert "locked" in r.text.lower()


def test_bare_prefix_redirects_to_slash(client_and_collector):
    client, _ = client_and_collector
    bare = client.get("/nahiarhdlog", follow_redirects=False)
    assert bare.status_code == 307
    assert bare.headers["location"] == "/nahiarhdlog/"
    with_token = client.get("/nahiarhdlog", params={"token": TOKEN}, follow_redirects=False)
    assert with_token.status_code == 307
    assert with_token.headers["location"] == f"/nahiarhdlog/?token={TOKEN}"
    followed = client.get("/nahiarhdlog", params={"token": TOKEN})
    assert followed.status_code == 200
    assert "logs-table" in followed.text


def test_api_without_token_is_json_401(client_and_collector):
    client, _ = client_and_collector
    r = client.get("/nahiarhdlog/api/health")
    assert r.status_code == 401
    assert r.headers["content-type"].startswith("application/json")


def test_wrong_token_is_403(client_and_collector):
    client, _ = client_and_collector
    assert client.get("/nahiarhdlog/api/health?token=nope").status_code == 403
    assert client.get("/nahiarhdlog/", params={"token": "nope"}).status_code == 401


def test_login_cookie_persists_without_url_token(client_and_collector):
    client, _ = client_and_collector
    r = client.post("/nahiarhdlog/api/login", json={"token": TOKEN})
    assert r.status_code == 200
    assert "nahiarhdlog_token" in r.cookies
    # Cookie alone now authenticates page + API (refresh-safe, new-tab-safe).
    assert client.get("/nahiarhdlog/api/health").status_code == 200
    page = client.get("/nahiarhdlog/")
    assert page.status_code == 200
    assert "logs-table" in page.text


def test_login_wrong_token_403_and_no_access(client_and_collector):
    client, _ = client_and_collector
    assert client.post("/nahiarhdlog/api/login", json={"token": "nope"}).status_code == 403
    assert client.post("/nahiarhdlog/api/login", json={}).status_code == 403
    assert client.get("/nahiarhdlog/api/health").status_code == 401


def test_logout_clears_cookie(client_and_collector):
    client, _ = client_and_collector
    assert client.post("/nahiarhdlog/api/login", json={"token": TOKEN}).status_code == 200
    assert client.get("/nahiarhdlog/api/health").status_code == 200
    assert client.post("/nahiarhdlog/api/logout").status_code == 200
    assert client.get("/nahiarhdlog/api/health").status_code == 401
    assert client.get("/nahiarhdlog/").status_code == 401


def test_dashboard_pages_are_never_cached(client_and_collector):
    # A cached index served after logout reboots the app into an infinite
    # 401 -> navigate -> cache-hit reload loop. Regression test.
    client, _ = client_and_collector
    authed = client.get("/nahiarhdlog/", params={"token": TOKEN})
    assert authed.status_code == 200
    assert authed.headers["cache-control"] == "no-store"
    lock = client.get("/nahiarhdlog/")
    assert lock.status_code == 401
    assert lock.headers["cache-control"] == "no-store"
    js = client.get("/nahiarhdlog/static/app.js")
    assert js.headers["cache-control"] == "no-store"


def test_bearer_header_accepted(client_and_collector):
    client, _ = client_and_collector
    r = client.get("/nahiarhdlog/api/health", headers={"Authorization": f"Bearer {TOKEN}"})
    assert r.status_code == 200
    assert r.json()["version"]


def test_index_and_static_served(client_and_collector):
    client, _ = client_and_collector
    r = client.get("/nahiarhdlog/", params={"token": TOKEN})
    assert r.status_code == 200
    assert "nahiarhdlog" in r.text
    assert 'rel="icon"' in r.text
    assert "static/favicon.svg" in r.text
    assert 'role="tablist"' in r.text
    assert 'role="tabpanel"' in r.text
    # Static assets are public (browsers can't token sub-resources); data is not.
    js = client.get("/nahiarhdlog/static/app.js")
    assert js.status_code == 200
    assert "javascript" in js.headers["content-type"]
    assert "displayMessage" in js.text
    assert "trace_id.slice(0, 12)" not in js.text
    assert "activateTab" in js.text
    assert "bindChartHover" in js.text
    assert "methodChip" in js.text
    assert "logMsgHtml" in js.text
    css = client.get("/nahiarhdlog/static/styles.css")
    assert css.status_code == 200
    assert "text/css" in css.headers["content-type"]
    assert "method-delete" in css.text
    assert "action-delete" in css.text
    assert "sev-mut" in css.text
    ico = client.get("/nahiarhdlog/static/favicon.svg")
    assert ico.status_code == 200
    assert "svg" in ico.headers["content-type"]
    assert b"<svg" in ico.content
    lock = client.get("/nahiarhdlog/")
    assert "static/favicon.svg" in lock.text
    assert "static/styles.css" in lock.text
    assert "nhl_theme" in lock.text
    assert 'for="token"' in lock.text


def test_static_traversal_blocked(client_and_collector):
    client, _ = client_and_collector
    assert client.get("/nahiarhdlog/static/../router.py").status_code in (404, 400)
    assert client.get("/nahiarhdlog/static/missing.js").status_code == 404


def test_logs_api_filters_and_pagination(client_and_collector):
    client, _ = client_and_collector
    q = {"token": TOKEN}
    all_rows = client.get("/nahiarhdlog/api/logs", params=q).json()
    assert all_rows["total"] == 4
    assert len(all_rows["items"]) == 4
    errors = client.get("/nahiarhdlog/api/logs", params={**q, "type": "error"}).json()
    assert errors["total"] == 2
    assert all(e["type"] == "error" for e in errors["items"])
    info = client.get("/nahiarhdlog/api/logs", params={**q, "level": "INFO"}).json()
    assert info["total"] == 1
    text = client.get("/nahiarhdlog/api/logs", params={**q, "text": "hello"}).json()
    assert text["total"] == 1
    sig = client.get(
        "/nahiarhdlog/api/logs", params={**q, "signature": "ValueError@x.py:9"}
    ).json()
    assert sig["total"] == 2
    traced = client.get("/nahiarhdlog/api/logs", params={**q, "trace_id": "t1"}).json()
    assert traced["total"] == 2
    page = client.get("/nahiarhdlog/api/logs", params={**q, "limit": 2, "offset": 2}).json()
    assert page["total"] == 4 and len(page["items"]) == 2 and page["offset"] == 2


def test_log_detail_and_404(client_and_collector):
    client, _ = client_and_collector
    q = {"token": TOKEN}
    first = client.get("/nahiarhdlog/api/logs", params={**q, "limit": 1}).json()["items"][0]
    detail = client.get(f"/nahiarhdlog/api/logs/{first['id']}", params=q)
    assert detail.status_code == 200
    assert detail.json()["id"] == first["id"]
    assert client.get("/nahiarhdlog/api/logs/999999", params=q).status_code == 404


def test_errors_top_trace_metrics_health(client_and_collector):
    client, _ = client_and_collector
    q = {"token": TOKEN}
    top = client.get("/nahiarhdlog/api/errors/top", params=q).json()
    assert top == [
        {
            "signature": "ValueError@x.py:9",
            "count": 2,
            "last_ts": pytest.approx(time.time(), abs=120),
            "last_message": "ValueError: worse",
        }
    ]
    trace = client.get("/nahiarhdlog/api/traces/t1", params=q).json()
    assert trace["trace_id"] == "t1"
    assert [e["type"] for e in trace["events"]] == ["log", "request"]
    summary = client.get("/nahiarhdlog/api/metrics/summary", params=q).json()
    assert summary["count"] == 1 and summary["errors"] == 0
    series = client.get(
        "/nahiarhdlog/api/metrics/series", params={**q, "window": 3600, "buckets": 4}
    ).json()
    assert len(series) == 4
    assert sum(b["count"] for b in series) == 1
    health = client.get("/nahiarhdlog/api/health", params=q).json()
    assert {"version", "queued", "dropped", "fts_available", "retention_days"} <= set(health)


def test_custom_prefix(tmp_path):
    from nahiarhdLOG.collector import Collector

    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        app = FastAPI()
        app.include_router(create_dashboard_router(collector, TOKEN), prefix="/ops")
        with TestClient(app) as client:
            assert client.get("/ops/api/health", params={"token": TOKEN}).status_code == 200
            assert client.get("/nahiarhdlog/api/health", params={"token": TOKEN}).status_code == 404
    finally:
        collector.stop()


def test_router_requires_token(tmp_path):
    from nahiarhdLOG.collector import Collector

    collector = Collector(str(tmp_path / "t.db"))
    try:
        with pytest.raises(ValueError):
            create_dashboard_router(collector, "")
    finally:
        collector.stop()
