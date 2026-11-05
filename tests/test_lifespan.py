"""Lifespan composition: observe() must stop the collector on shutdown
without breaking a user-defined lifespan (the AI-Agents case)."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.testclient import TestClient

from nahiarhdLOG import observe


def test_shutdown_runs_when_lifespan_exits(tmp_path):
    app = FastAPI()
    collector = observe(app, db_path=str(tmp_path / "t.db"))
    with TestClient(app):
        pass
    assert not collector._thread.is_alive()


def test_custom_lifespan_still_runs(tmp_path):
    events = []

    @asynccontextmanager
    async def lifespan(app):
        events.append("up")
        yield
        events.append("down")

    app = FastAPI(lifespan=lifespan)
    collector = observe(app, db_path=str(tmp_path / "t.db"))
    with TestClient(app):
        pass
    assert events == ["up", "down"]
    assert not collector._thread.is_alive()


def test_lifespan_state_passes_through(tmp_path):
    @asynccontextmanager
    async def lifespan(app):
        yield {"ping": "pong"}

    app = FastAPI(lifespan=lifespan)
    observe(app, db_path=str(tmp_path / "t.db"))

    async def main():
        async with app.router.lifespan_context(app) as state:
            return state

    assert asyncio.run(main()) == {"ping": "pong"}


def test_collector_restarts_when_lifespan_runs_again(tmp_path):
    # Regression: the first shutdown stopped the collector for good, so a
    # second TestClient (one per test is common) logged nothing and every
    # dashboard read hit a closed database.
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {"ok": True}

    collector = observe(app, db_path=str(tmp_path / "t.db"), dashboard_token="tok")
    with TestClient(app) as client:
        client.get("/ping")
    assert not collector.running
    with TestClient(app) as client:
        assert collector.running
        client.get("/ping")
        assert collector.flush()
        r = client.get("/nahiarhdlog/api/logs", params={"type": "request"},
                       headers={"Authorization": "Bearer tok"})
        assert r.status_code == 200
        assert r.json()["total"] == 2
    assert not collector._thread.is_alive()
