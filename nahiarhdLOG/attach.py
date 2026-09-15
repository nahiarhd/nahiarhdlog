"""Process-level capture: collector + stdlib handler + excepthook, no web app.

Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import atexit
import logging

from .collector import DEFAULT_DB_PATH, Collector
from .handler import ensure_handler, install_excepthook


def attach(
    db_path: str = DEFAULT_DB_PATH,
    *,
    retention_days: int = 7,
    level: int = logging.INFO,
    source: str | None = None,
) -> Collector:
    """Capture this process's stdlib logs and uncaught exceptions.

    Point `db_path` at the same SQLite file as `observe()` so a worker,
    cron job, or script shows up in the existing dashboard. `source` is
    an optional tag stored on each event's `data` — the dashboard does
    not filter on it.
    """
    extra = {"source": source} if source else None
    collector = Collector(
        db_path, retention_days=retention_days, default_data=extra
    ).start()
    root = logging.getLogger()
    # Root defaults to WARNING, which would drop INFO before our handler.
    if root.level == logging.NOTSET or root.level > level:
        root.setLevel(level)
    ensure_handler(collector, level)
    install_excepthook(collector)
    atexit.register(collector.stop)
    return collector
