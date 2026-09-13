"""SQLite storage: WAL mode, FTS5 full-text search, retention purge.

Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any, Iterable

_SCHEMA = """
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    ts REAL NOT NULL,
    type TEXT NOT NULL,
    level TEXT,
    message TEXT NOT NULL,
    trace_id TEXT,
    data TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events (ts);
CREATE INDEX IF NOT EXISTS idx_events_level ON events (level);
CREATE INDEX IF NOT EXISTS idx_events_trace ON events (trace_id);
CREATE INDEX IF NOT EXISTS idx_events_type ON events (type);
"""

_FTS_SCHEMA = """
CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(message, content='events', content_rowid='id');
CREATE TRIGGER IF NOT EXISTS events_ai AFTER INSERT ON events BEGIN
    INSERT INTO events_fts (rowid, message) VALUES (new.id, new.message);
END;
CREATE TRIGGER IF NOT EXISTS events_ad AFTER DELETE ON events BEGIN
    INSERT INTO events_fts (events_fts, rowid, message) VALUES ('delete', old.id, old.message);
END;
"""

_MAX_LIMIT = 1000


def _row_to_event(row: sqlite3.Row) -> dict[str, Any]:
    try:
        data = json.loads(row["data"]) if row["data"] else {}
    except ValueError:
        data = {}
    return {
        "id": row["id"],
        "ts": row["ts"],
        "type": row["type"],
        "level": row["level"],
        "message": row["message"],
        "trace_id": row["trace_id"],
        "data": data,
    }


class SQLiteStorage:
    """Single-writer SQLite store. All methods are thread-safe."""

    def __init__(self, path: str, retention_days: int = 7) -> None:
        self.path = path
        self.retention_days = retention_days
        self._conn = sqlite3.connect(path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._lock = threading.Lock()
        with self._lock:
            self._conn.execute("PRAGMA journal_mode=WAL;")
            self._conn.execute("PRAGMA busy_timeout=5000;")
            self._conn.executescript(_SCHEMA)
            self._fts = self._try_enable_fts()
        self.purge()

    @property
    def fts_available(self) -> bool:
        return self._fts

    def _try_enable_fts(self) -> bool:
        try:
            self._conn.executescript(_FTS_SCHEMA)
            return True
        except sqlite3.OperationalError:
            return False

    def insert_many(self, events: Iterable[dict[str, Any]]) -> int:
        rows = [
            (
                e.get("ts", time.time()),
                e.get("type", "log"),
                e.get("level"),
                e.get("message", ""),
                e.get("trace_id"),
                json.dumps(e.get("data") or {}, default=str),
            )
            for e in events
        ]
        if not rows:
            return 0
        with self._lock:
            self._conn.executemany(
                "INSERT INTO events (ts, type, level, message, trace_id, data)"
                " VALUES (?, ?, ?, ?, ?, ?)",
                rows,
            )
            self._conn.commit()
        return len(rows)

    def _filters(
        self,
        text: str | None,
        level: str | list[str] | None,
        event_type: str | None,
        trace_id: str | None,
        signature: str | None,
        since: float | None,
        until: float | None,
    ) -> tuple[str, list[Any], str | None]:
        clauses: list[str] = []
        params: list[Any] = []
        join = ""
        if text and self._fts:
            join = "JOIN events_fts f ON f.rowid = e.id"
            clauses.append("events_fts MATCH ?")
            params.append('"' + text.replace('"', '""') + '"')
        elif text:
            clauses.append("e.message LIKE ?")
            params.append(f"%{text}%")
        if level:
            levels = [level] if isinstance(level, str) else list(level)
            clauses.append(f"e.level IN ({', '.join('?' * len(levels))})")
            params.extend(levels)
        if event_type:
            clauses.append("e.type = ?")
            params.append(event_type)
        if trace_id:
            clauses.append("e.trace_id = ?")
            params.append(trace_id)
        if signature:
            clauses.append("json_extract(e.data, '$.signature') = ?")
            params.append(signature)
        if since is not None:
            clauses.append("e.ts >= ?")
            params.append(since)
        if until is not None:
            clauses.append("e.ts <= ?")
            params.append(until)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return join, params, where

    def search(
        self,
        text: str | None = None,
        level: str | list[str] | None = None,
        event_type: str | None = None,
        trace_id: str | None = None,
        signature: str | None = None,
        since: float | None = None,
        until: float | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> list[dict[str, Any]]:
        limit = max(1, min(int(limit), _MAX_LIMIT))
        offset = max(0, int(offset))
        join, params, where = self._filters(
            text, level, event_type, trace_id, signature, since, until
        )
        sql = (
            f"SELECT e.* FROM events e {join} {where}"
            " ORDER BY e.ts DESC, e.id DESC LIMIT ? OFFSET ?"
        )
        try:
            with self._lock:
                rows = self._conn.execute(sql, (*params, limit, offset)).fetchall()
        except sqlite3.OperationalError:
            if not text or not self._fts:
                raise
            with self._lock:
                rows = self._conn.execute(
                    "SELECT e.* FROM events e WHERE e.message LIKE ?"
                    " ORDER BY e.ts DESC, e.id DESC LIMIT ? OFFSET ?",
                    (f"%{text}%", limit, offset),
                ).fetchall()
        return [_row_to_event(r) for r in rows]

    def count(
        self,
        text: str | None = None,
        level: str | list[str] | None = None,
        event_type: str | None = None,
        trace_id: str | None = None,
        signature: str | None = None,
        since: float | None = None,
        until: float | None = None,
    ) -> int:
        join, params, where = self._filters(
            text, level, event_type, trace_id, signature, since, until
        )
        sql = f"SELECT COUNT(*) AS n FROM events e {join} {where}"
        try:
            with self._lock:
                row = self._conn.execute(sql, params).fetchone()
        except sqlite3.OperationalError:
            if not text or not self._fts:
                raise
            with self._lock:
                row = self._conn.execute(
                    "SELECT COUNT(*) AS n FROM events e WHERE e.message LIKE ?",
                    (f"%{text}%",),
                ).fetchone()
        return int(row["n"])

    def top_signatures(
        self, since: float | None = None, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Group errors by signature. Returns [{signature, count, last_ts}]."""
        limit = max(1, min(int(limit), _MAX_LIMIT))
        sql = (
            "SELECT COALESCE(json_extract(data, '$.signature'), '(unknown)') AS sig,"
            " COUNT(*) AS n, MAX(ts) AS last_ts FROM events"
            " WHERE type = 'error'"
        )
        params: list[Any] = []
        if since is not None:
            sql += " AND ts >= ?"
            params.append(since)
        sql += " GROUP BY sig ORDER BY n DESC, last_ts DESC LIMIT ?"
        params.append(limit)
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [
            {"signature": r["sig"], "count": r["n"], "last_ts": r["last_ts"]}
            for r in rows
        ]

    def fetch_requests(
        self, since: float | None = None, until: float | None = None
    ) -> list[dict[str, Any]]:
        """Lightweight rows for metrics: [{ts, status, duration_ms}]."""
        sql = (
            "SELECT ts, json_extract(data, '$.status') AS status,"
            " json_extract(data, '$.duration_ms') AS dur"
            " FROM events WHERE type = 'request'"
        )
        params: list[Any] = []
        if since is not None:
            sql += " AND ts >= ?"
            params.append(since)
        if until is not None:
            sql += " AND ts <= ?"
            params.append(until)
        sql += " ORDER BY ts"
        with self._lock:
            rows = self._conn.execute(sql, params).fetchall()
        return [
            {"ts": r["ts"], "status": r["status"], "duration_ms": r["dur"]}
            for r in rows
        ]

    def get(self, event_id: int) -> dict[str, Any] | None:
        with self._lock:
            row = self._conn.execute(
                "SELECT * FROM events WHERE id = ?", (event_id,)
            ).fetchone()
        return _row_to_event(row) if row else None

    def purge(self) -> int:
        """Delete events older than the retention window. Returns rows removed."""
        if self.retention_days <= 0:
            return 0
        cutoff = time.time() - self.retention_days * 86400
        with self._lock:
            cur = self._conn.execute("DELETE FROM events WHERE ts < ?", (cutoff,))
            self._conn.commit()
            return cur.rowcount

    def close(self) -> None:
        with self._lock:
            self._conn.close()
