"""Embedded dashboard: JSON API + static UI, token-protected.

Dashboard zone: allowed to import FastAPI/Starlette (see adapter boundary test).
"""

from __future__ import annotations

import hmac
from importlib import resources
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import FileResponse, JSONResponse

from .. import __version__
from ..metrics import request_stats, timeseries
from ..query import LogFilter, count_logs, get_event, get_trace, search_logs, top_errors

_MEDIA = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript",
    ".css": "text/css; charset=utf-8",
}
_COOKIE_NAME = "nahiarhdlog_token"
# Auth-dependent pages must never be cached: a cached index served after
# logout reboots the app, its API calls 401, the 401 handler navigates,
# the navigation hits the cache again — an infinite reload loop.
_NO_STORE = {"Cache-Control": "no-store", "Pragma": "no-cache", "Expires": "0"}


def _static_root() -> Path:
    return Path(str(resources.files("nahiarhdLOG.dashboard") / "static"))


def _static_file(name: str, status_code: int = 200) -> FileResponse:
    root = _static_root().resolve()
    if "/" in name or "\\" in name or name.startswith("."):
        raise HTTPException(status_code=404)
    path = (root / name).resolve()
    if path.parent != root or not path.is_file():
        raise HTTPException(status_code=404)
    return FileResponse(
        path,
        media_type=_MEDIA.get(path.suffix, "application/octet-stream"),
        status_code=status_code,
        headers=_NO_STORE,
    )


def create_dashboard_router(collector: Any, token: str) -> APIRouter:
    """Build the mountable dashboard router. Token is mandatory."""
    if not token:
        raise ValueError("dashboard token is required")

    def _provided(request: Request) -> str | None:
        provided = request.query_params.get("token")
        if not provided:
            auth = request.headers.get("authorization", "")
            if auth.lower().startswith("bearer "):
                provided = auth[7:].strip()
        if not provided:
            provided = request.cookies.get(_COOKIE_NAME)
        return provided or None

    def _check(request: Request) -> None:
        provided = _provided(request)
        if not provided:
            raise HTTPException(status_code=401, detail="dashboard token required")
        if not hmac.compare_digest(provided, token):
            raise HTTPException(status_code=403, detail="invalid dashboard token")

    def _page(request: Request, name: str) -> FileResponse:
        provided = _provided(request)
        if not provided or not hmac.compare_digest(provided, token):
            return _static_file("lock.html", status_code=401)
        return _static_file(name)

    authed = Depends(_check)
    router = APIRouter()

    @router.get("/")
    def index(request: Request) -> FileResponse:
        return _page(request, "index.html")

    # Static assets are public by design: browsers cannot attach tokens to
    # sub-resource requests. They carry no data; every API call stays locked.
    @router.get("/static/{name:path}")
    def static(name: str) -> FileResponse:
        return _static_file(name)

    @router.post("/api/login")
    async def login(request: Request) -> JSONResponse:
        try:
            data = await request.json()
        except Exception:
            data = None
        provided = data.get("token") if isinstance(data, dict) else None
        if not provided or not hmac.compare_digest(str(provided), token):
            raise HTTPException(status_code=403, detail="invalid dashboard token")
        resp = JSONResponse({"ok": True})
        resp.set_cookie(
            _COOKIE_NAME, token, httponly=True, samesite="lax", path="/"
        )
        return resp

    @router.post("/api/logout")
    def logout() -> JSONResponse:
        resp = JSONResponse({"ok": True})
        resp.delete_cookie(_COOKIE_NAME, path="/")
        return resp

    @router.get("/api/health", dependencies=[authed])
    def health() -> dict[str, Any]:
        return {
            "version": __version__,
            "queued": collector.queued,
            "dropped": collector.dropped,
            "fts_available": collector.storage.fts_available,
            "retention_days": collector.storage.retention_days,
        }

    @router.get("/api/logs", dependencies=[authed])
    def logs(
        text: str | None = None,
        level: list[str] | None = Query(default=None),
        event_type: str | None = Query(default=None, alias="type"),
        trace_id: str | None = None,
        signature: str | None = None,
        since: float | None = None,
        until: float | None = None,
        limit: int = 100,
        offset: int = 0,
    ) -> dict[str, Any]:
        filt = LogFilter(
            text=text,
            level=level,
            event_type=event_type,
            trace_id=trace_id,
            signature=signature,
            since=since,
            until=until,
            limit=limit,
            offset=offset,
        ).normalized()
        return {
            "items": search_logs(collector.storage, filt),
            "total": count_logs(collector.storage, filt),
            "limit": filt.limit,
            "offset": filt.offset,
        }

    @router.get("/api/logs/{event_id}", dependencies=[authed])
    def log_detail(event_id: int) -> dict[str, Any]:
        event = get_event(collector.storage, event_id)
        if event is None:
            raise HTTPException(status_code=404, detail="event not found")
        return event

    @router.get("/api/errors/top", dependencies=[authed])
    def errors_top(
        since: float | None = None, limit: int = 20
    ) -> list[dict[str, Any]]:
        return top_errors(collector.storage, since=since, limit=limit)

    @router.get("/api/traces/{trace_id}", dependencies=[authed])
    def trace(trace_id: str) -> dict[str, Any]:
        return {"trace_id": trace_id, "events": get_trace(collector.storage, trace_id)}

    @router.get("/api/metrics/summary", dependencies=[authed])
    def metrics_summary(window: float = 300) -> dict[str, Any]:
        window = max(60.0, min(float(window), 7 * 86400.0))
        return request_stats(collector.storage, window_seconds=window)

    @router.get("/api/metrics/series", dependencies=[authed])
    def metrics_series(
        window: float = 3600, buckets: int = 60
    ) -> list[dict[str, Any]]:
        window = max(60.0, min(float(window), 7 * 86400.0))
        buckets = max(1, min(int(buckets), 500))
        return timeseries(collector.storage, window_seconds=window, buckets=buckets)

    return router
