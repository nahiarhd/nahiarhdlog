"""Postgres storage: shared history for multi-replica deployments.

Duck-typed like :class:`nahiarhdLOG.storage.SQLiteStorage` so it plugs into
``Collector(storage=...)``. Point ``db_path`` at a ``postgresql://`` URL and
the collector picks this backend automatically; every pod then reads and
writes the same table and the dashboard stops flip-flopping between
per-pod SQLite files.

Requires the ``postgres`` extra (``pip install nahiarhdlog[postgres]``).
The driver import stays lazy so ``import nahiarhdLOG`` never needs it.

Framework-agnostic: this module must never import FastAPI/Starlette.
"""

from __future__ import annotations

import json
import threading
import time
from typing import Any, Callable, Iterable, TypeVar

try:
    import psycopg
    from psycopg.rows import dict_row
except ImportError:  # pragma: no cover - exercised via monkeypatched global
    psycopg = None  # type: ignore[assignment]
    dict_row = None  # type: ignore[assignment]

_TABLE = "nahiarhdlog_events"
_MAX_LIMIT = 1000

_SCHEMA_STATEMENTS = (
    f"""CREATE TABLE IF NOT EXISTS {_TABLE} (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    ts DOUBLE PRECISION NOT NULL,
    type TEXT NOT NULL,
    level TEXT,
    message TEXT NOT NULL,
    trace_id TEXT,
    data JSONB NOT NULL DEFAULT '{{}}'
)""",
    f"CREATE INDEX IF NOT EXISTS idx_{_TABLE}_ts ON {_TABLE} (ts)",
    f"CREATE INDEX IF NOT EXISTS idx_{_TABLE}_level ON {_TABLE} (level)",
    f"CREATE INDEX IF NOT EXISTS idx_{_TABLE}_trace ON {_TABLE} (trace_id)",
    f"CREATE INDEX IF NOT EXISTS idx_{_TABLE}_type ON {_TABLE} (type)",
)

T = TypeVar("T")


def _require_driver() -> Any:
    if psycopg is None:
        raise ImportError(
            "PostgresStorage needs the 'postgres' extra: "
            "pip install nahiarhdlog[postgres]"
        )
    return psycopg


def _escape_like(text: str) -> str:
    return text.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _row_to_event(row: dict[str, Any]) -> dict[str, Any]:
    data = row["data"]
    if not isinstance(data, dict):
        try:
            data = json.loads(data) if data else {}
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


class PostgresStorage:
    """Multi-writer Postgres store. All methods are thread-safe."""

    # Every replica reads and writes the same table.
    shared = True

    def __init__(self, dsn: str, retention_days: int = 7, timeout: float = 15.0) -> None:
        _require_driver()
        self.dsn = dsn
        self.retention_days = retention_days
        self.timeout = timeout
        self._lock = threading.Lock()
        self._closed = False
        self._conn = self._connect()
        try:
            self.purge()
        except Exception:
            pass

    @property
    def fts_available(self) -> bool:
        # Text search is ILIKE; no tsvector index is maintained.
        return False

    def _connect(self) -> Any:
        assert psycopg is not None  # guaranteed by _require_driver in __init__
        conn = psycopg.connect(
            self.dsn, row_factory=dict_row, connect_timeout=int(self.timeout)
        )
        try:
            for statement in _SCHEMA_STATEMENTS:
                conn.execute(statement)
            conn.commit()
        except Exception:
            conn.close()
            raise
        return conn

    def _run(self, op: Callable[[Any], T]) -> T:
        """Run `op` under the lock, reconnecting once on connection failure."""
        if self._closed:
            raise psycopg.InterfaceError("PostgresStorage is closed")
        with self._lock:
            try:
                return op(self._conn)
            except (psycopg.OperationalError, psycopg.InterfaceError):
                try:
                    self._conn.rollback()
                except Exception:
                    pass
                try:
                    self._conn.close()
                except Exception:
                    pass
                self._conn = self._connect()
                try:
                    return op(self._conn)
                except Exception:
                    try:
                        self._conn.rollback()
                    except Exception:
                        pass
                    raise
            except Exception:
                try:
                    self._conn.rollback()
                except Exception:
                    pass
                raise

    def insert_many(self, events: Iterable[dict[str, Any]], max_retries: int = 5) -> int:
        _ = max_retries  # accepted for SQLiteStorage parity; PG needs no lock retry
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

        def _op(conn: Any) -> int:
            with conn.cursor() as cur:
                cur.executemany(
                    f"INSERT INTO {_TABLE} (ts, type, level, message, trace_id, data)"
                    " VALUES (%s, %s, %s, %s, %s, CAST(%s AS jsonb))",
                    rows,
                )
            conn.commit()
            return len(rows)

        return self._run(_op)

    def _filters(
        self,
        text: str | None,
        level: str | list[str] | None,
        event_type: str | None,
        trace_id: str | None,
        signature: str | None,
        since: float | None,
        until: float | None,
    ) -> tuple[str, list[Any]]:
        clauses: list[str] = []
        params: list[Any] = []
        if text:
            clauses.append("e.message ILIKE %s")
            params.append(f"%{_escape_like(text)}%")
        if level:
            levels = [level] if isinstance(level, str) else list(level)
            clauses.append(f"e.level IN ({', '.join(['%s'] * len(levels))})")
            params.extend(levels)
        if event_type:
            clauses.append("e.type = %s")
            params.append(event_type)
        if trace_id:
            clauses.append("e.trace_id = %s")
            params.append(trace_id)
        if signature:
            clauses.append("(e.data ->> 'signature') = %s")
            params.append(signature)
        if since is not None:
            clauses.append("e.ts >= %s")
            params.append(since)
        if until is not None:
            clauses.append("e.ts <= %s")
            params.append(until)
        where = f"WHERE {' AND '.join(clauses)}" if clauses else ""
        return where, params

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
        where, params = self._filters(
            text, level, event_type, trace_id, signature, since, until
        )
        sql = (
            f"SELECT e.* FROM {_TABLE} e {where}"
            " ORDER BY e.ts DESC, e.id DESC LIMIT %s OFFSET %s"
        )
        rows = self._run(
            lambda conn: conn.execute(sql, (*params, limit, offset)).fetchall()
        )
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
        where, params = self._filters(
            text, level, event_type, trace_id, signature, since, until
        )
        sql = f"SELECT COUNT(*) AS n FROM {_TABLE} e {where}"
        row = self._run(lambda conn: conn.execute(sql, params).fetchone())
        return int(row["n"])

    def top_signatures(
        self, since: float | None = None, limit: int = 20
    ) -> list[dict[str, Any]]:
        """Group errors by signature. Returns [{signature, count, last_ts, last_message}]."""
        limit = max(1, min(int(limit), _MAX_LIMIT))
        where = "WHERE type = 'error'"
        params: list[Any] = []
        if since is not None:
            where += " AND ts >= %s"
            params.append(since)
        sql = (
            "SELECT g.sig AS sig, g.n AS n, g.last_ts AS last_ts,"
            " e.message AS last_message"
            " FROM ("
            "  SELECT COALESCE(data ->> 'signature', '(unknown)') AS sig,"
            "  COUNT(*) AS n, MAX(ts) AS last_ts, MAX(id) AS last_id"
            f"  FROM {_TABLE} {where}"
            "  GROUP BY sig ORDER BY n DESC, last_ts DESC LIMIT %s"
            f" ) g JOIN {_TABLE} e ON e.id = g.last_id"
        )
        params.append(limit)
        rows = self._run(lambda conn: conn.execute(sql, params).fetchall())
        return [
            {
                "signature": r["sig"],
                "count": r["n"],
                "last_ts": r["last_ts"],
                "last_message": r["last_message"],
            }
            for r in rows
        ]

    def resolve_trace_id(self, prefix: str) -> str | None:
        """Return the unique trace_id that starts with `prefix`, else None."""
        if not prefix or len(prefix) < 8:
            return None
        rows = self._run(
            lambda conn: conn.execute(
                f"SELECT DISTINCT trace_id FROM {_TABLE}"
                " WHERE trace_id LIKE %s LIMIT 2",
                (_escape_like(prefix) + "%",),
            ).fetchall()
        )
        if len(rows) != 1:
            return None
        return rows[0]["trace_id"]

    def fetch_requests(
        self, since: float | None = None, until: float | None = None
    ) -> list[dict[str, Any]]:
        """Lightweight rows for metrics: [{ts, status, duration_ms}]."""
        sql = (
            "SELECT ts, (data ->> 'status')::integer AS status,"
            " (data ->> 'duration_ms')::double precision AS dur"
            f" FROM {_TABLE} WHERE type = 'request'"
        )
        params: list[Any] = []
        if since is not None:
            sql += " AND ts >= %s"
            params.append(since)
        if until is not None:
            sql += " AND ts <= %s"
            params.append(until)
        sql += " ORDER BY ts"
        rows = self._run(lambda conn: conn.execute(sql, params).fetchall())
        return [
            {"ts": r["ts"], "status": r["status"], "duration_ms": r["dur"]}
            for r in rows
        ]

    def get(self, event_id: int) -> dict[str, Any] | None:
        row = self._run(
            lambda conn: conn.execute(
                f"SELECT * FROM {_TABLE} WHERE id = %s", (event_id,)
            ).fetchone()
        )
        return _row_to_event(row) if row else None

    def purge(self, max_retries: int = 3) -> int:
        """Delete events older than the retention window. Returns rows removed."""
        _ = max_retries  # accepted for SQLiteStorage parity; PG needs no lock retry
        if self.retention_days <= 0:
            return 0
        cutoff = time.time() - self.retention_days * 86400

        def _op(conn: Any) -> int:
            cur = conn.execute(f"DELETE FROM {_TABLE} WHERE ts < %s", (cutoff,))
            conn.commit()
            return cur.rowcount

        return self._run(_op)

    def close(self) -> None:
        with self._lock:
            self._closed = True
            try:
                self._conn.close()
            except Exception:
                pass
