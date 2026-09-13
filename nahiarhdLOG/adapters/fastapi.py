"""FastAPI adapter: the only module (with the dashboard) allowed to
import FastAPI/Starlette. One call wires middleware + handler + excepthook."""

from __future__ import annotations

import logging
from collections.abc import Callable
from contextlib import asynccontextmanager
from typing import Any

from ..alerter import Alerter, AlertSink, Rule
from ..collector import Collector
from ..handler import NahiarhdHandler, install_excepthook
from ..middleware import LoggingMiddleware


def _ensure_handler(collector: Collector, level: int) -> None:
    root = logging.getLogger()
    for h in root.handlers:
        if isinstance(h, NahiarhdHandler) and h.collector is collector:
            h.setLevel(level)
            return
    root.addHandler(NahiarhdHandler(collector, level=level))


def observe(
    app: Any,
    db_path: str = "nahiarhdlog.db",
    retention_days: int = 7,
    sample_rate: float = 1.0,
    level: int = logging.INFO,
    rules: list[Rule] | None = None,
    sinks: list[AlertSink] | None = None,
    dashboard_prefix: str = "/admin/logs",
    dashboard_token: str | None = None,
    skip_paths: list[str] | None = None,
) -> Collector:
    """Attach nahiarhdlog to a FastAPI app. Returns the collector.

    The dashboard is mounted only when `dashboard_token` is set: it must
    never be reachable without a key. The dashboard's own traffic is never
    logged, so live tail can't flood itself.
    """
    alerter = None
    if rules and sinks:
        alerter = Alerter(rules, sinks).start()
    collector = Collector(
        db_path, retention_days=retention_days, alerter=alerter
    ).start()
    prefix = (dashboard_prefix or "/admin/logs").rstrip("/") or "/admin/logs"
    skips = list(skip_paths or [])
    if dashboard_token and prefix not in skips:
        skips.append(prefix)
    app.add_middleware(
        LoggingMiddleware,
        collector=collector,
        sample_rate=sample_rate,
        skip_prefixes=tuple(skips),
    )
    _ensure_handler(collector, level)
    install_excepthook(collector)
    if dashboard_token:
        from ..dashboard.router import create_dashboard_router

        app.include_router(
            create_dashboard_router(collector, dashboard_token), prefix=prefix
        )

    def _shutdown() -> None:
        collector.stop()
        if alerter is not None:
            alerter.stop()

    _chain_shutdown(app, _shutdown)
    return collector


def _chain_shutdown(app: Any, hook: Callable[[], None]) -> None:
    """Run `hook` on app shutdown via lifespan composition.

    Wraps `router.lifespan_context` so a user-defined lifespan keeps
    running untouched and its state passes through to requests.
    `on_startup`/`on_shutdown` are deprecated upstream and removed in
    Starlette 1.x, so they remain only as a fallback for ancient versions.
    Sources:
    - https://starlette.dev/lifespan/
    - https://fastapi.tiangolo.com/advanced/events/#alternative-events-deprecated
    """
    router = getattr(app, "router", None)
    prev = getattr(router, "lifespan_context", None)
    if prev is None:
        legacy = getattr(router, "on_shutdown", None)
        if legacy is not None:
            legacy.append(hook)
        return

    @asynccontextmanager
    async def _nahiarhdlog_lifespan(inner_app: Any):
        try:
            async with prev(inner_app) as state:
                yield state
        finally:
            hook()

    router.lifespan_context = _nahiarhdlog_lifespan
