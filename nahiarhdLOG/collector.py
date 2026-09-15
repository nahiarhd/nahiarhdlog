"""Central hub: bounded queue + batch writer thread + storage.

Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import queue
import threading
import time
from typing import TYPE_CHECKING, Any

from .storage import SQLiteStorage

if TYPE_CHECKING:
    from .alerter import Alerter

_FLUSH_INTERVAL = 0.2  # seconds
_BATCH_SIZE = 500
_PURGE_INTERVAL = 3600.0  # seconds

# Default on-disk location: a dot-directory keeps project roots clean.
DEFAULT_DB_PATH = ".nahiarhdlog/nahiarhdlog.db"


class Collector:
    """Receives events without blocking callers and persists them in batches."""

    def __init__(
        self,
        db_path: str = DEFAULT_DB_PATH,
        retention_days: int = 7,
        queue_size: int = 10_000,
        alerter: Alerter | None = None,
        storage: SQLiteStorage | None = None,
        default_data: dict[str, Any] | None = None,
    ) -> None:
        # Custom backends (e.g. Postgres) plug in here; anything duck-typed
        # like SQLiteStorage works. Default stays zero-infrastructure.
        self.storage = (
            storage
            if storage is not None
            else SQLiteStorage(db_path, retention_days=retention_days)
        )
        self.alerter = alerter
        self._default_data = dict(default_data) if default_data else {}
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=queue_size)
        self._dropped = 0
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._started = False
        self._last_purge = time.monotonic()
        self._thread = threading.Thread(
            target=self._run, name="nahiarhdlog-writer", daemon=True
        )

    @property
    def dropped(self) -> int:
        with self._lock:
            return self._dropped

    @property
    def queued(self) -> int:
        return self._queue.qsize()

    def start(self) -> Collector:
        if self._started:
            return self
        self._started = True
        self._thread.start()
        return self

    def emit(self, event: dict[str, Any]) -> bool:
        """Queue one event. Never blocks; returns False when dropped."""
        if self._default_data:
            event = {
                **event,
                "data": {**self._default_data, **(event.get("data") or {})},
            }
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            with self._lock:
                self._dropped += 1
            return False
        if self.alerter is not None and event.get("type") == "error":
            try:
                self.alerter.notify(event)
            except Exception:
                pass
        return True

    def flush(self, timeout: float = 10.0) -> bool:
        """Block until queued events are persisted. Returns False on timeout."""
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks:
            if time.monotonic() > deadline:
                return False
            time.sleep(0.01)
        return True

    def stop(self, timeout: float = 10.0) -> None:
        if not self._started:
            return
        self._started = False
        self._stop.set()
        self._thread.join(timeout=timeout)
        self.storage.close()

    def _insert(self, batch: list[dict[str, Any]]) -> None:
        try:
            self.storage.insert_many(batch)
        finally:
            for _ in batch:
                self._queue.task_done()

    def _run(self) -> None:
        batch: list[dict[str, Any]] = []
        last_flush = time.monotonic()
        while not self._stop.is_set():
            try:
                batch.append(self._queue.get(timeout=_FLUSH_INTERVAL))
            except queue.Empty:
                pass
            now = time.monotonic()
            if batch and (
                len(batch) >= _BATCH_SIZE or now - last_flush >= _FLUSH_INTERVAL
            ):
                self._insert(batch)
                batch = []
                last_flush = now
            if now - self._last_purge >= _PURGE_INTERVAL:
                self._last_purge = now
                try:
                    self.storage.purge()
                except Exception:
                    pass
        while True:
            try:
                batch.append(self._queue.get_nowait())
            except queue.Empty:
                break
        if batch:
            self._insert(batch)
