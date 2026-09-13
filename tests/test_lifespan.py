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
