# nahiarhdlog

[![PyPI version](https://img.shields.io/pypi/v/nahiarhdlog.svg)](https://pypi.org/project/nahiarhdlog/)
[![Python Version](https://img.shields.io/pypi/pyversions/nahiarhdlog.svg)](https://pypi.org/project/nahiarhdlog/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

Embedded observability for FastAPI: searchable logs, error tracking, alerts, metrics, and tracing — with zero-config defaults.

```python
from fastapi import FastAPI
from nahiarhdLOG import observe

app = FastAPI()
observe(app, dashboard_token="secret")  # logs + errors + metrics + dashboard
```

> **Status:** FastAPI is supported first. The core is framework-agnostic, so Flask/Django adapters can follow without changing it.

## 2-minute install

```bash
pip install nahiarhdlog
```

Requires Python >= 3.10. No servers, no agents, no config files: events are stored in a local SQLite file (`nahiarhdlog.db`).

## Quick start

```python
import logging
from fastapi import FastAPI
from nahiarhdLOG import observe

app = FastAPI()
observe(app, dashboard_token="secret")

log = logging.getLogger(__name__)

@app.get("/users/{user_id}")
def get_user(user_id: int):
    log.info("fetching user %d", user_id)
    return {"id": user_id}
```

That's it. Every request, every stdlib log record, and every uncaught exception is now captured. Open the dashboard at `/admin/logs` (enter the token on the lock screen).

## Configuration

`observe()` takes explicit arguments and never reads your environment or `.env` file itself — each app owns its config, so the same package works unchanged across projects:

| Argument | Default | Meaning |
|---|---|---|
| `db_path` | `"nahiarhdlog.db"` | SQLite file for events |
| `dashboard_token` | `None` (dashboard off) | Token for the dashboard; unset = no dashboard |
| `dashboard_prefix` | `"/admin/logs"` | Where the dashboard lives |
| `retention_days` | `7` | How long events are kept |

Typical `.env`-based wiring in your app:

```bash
# .env (never commit this file)
NAHILOG_DB=/var/lib/myapp/nahiarhdlog.db
NAHILOG_TOKEN=long-random-secret
```

```python
import os
from fastapi import FastAPI
from nahiarhdLOG import observe

app = FastAPI()
observe(
    app,
    db_path=os.environ.get("NAHILOG_DB", "nahiarhdlog.db"),
    dashboard_token=os.environ.get("NAHILOG_TOKEN"),  # None = dashboard disabled
)
```

> If your app loads `.env` via `dotenv_values` (read-only dict) instead of `load_dotenv`, `os.environ` won't see those values — pass them through your env helper instead.

## Features

| Area | What you get |
| ---- | ------------ |
| Logs | Auto-captured stdlib records + requests; full-text search (FTS5), level/type/time/trace filters, pagination |
| Errors | Grouped by `ExcType@file.py:line`, full tracebacks, top-errors ranking |
| Alerts | Threshold rules (N events in M seconds) + cooldown; webhook, Telegram, and SMTP sinks |
| Metrics | RPS, error rate, latency p50/p95, time-bucketed series — computed from the same request events |
| Tracing | One `trace_id` per request shared by logs and errors; timeline view; optional OpenTelemetry export |
| Dashboard | Embedded at `/admin/logs`, token-locked, dark/light mode, mobile-friendly, live tail |

Design limits (on purpose): bounded in-memory queue (full → drop + visible counter, requests are never blocked), batched async writes, paginated queries. Measured middleware overhead: p95 ~0.04 ms (see `scripts/probe_perf.py`).

## Configuration

```python
from nahiarhdLOG.alerter import Rule, TelegramSink, WebhookSink

observe(
    app,
    db_path="nahiarhdlog.db",   # local SQLite file (WAL mode)
    retention_days=7,            # auto-purge older events
    sample_rate=1.0,             # 1.0 = every request; 500s are always kept
    level=logging.INFO,          # minimum stdlib level captured
    rules=[Rule("errors", count=5, window_seconds=300, cooldown_seconds=3600)],
    sinks=[TelegramSink(bot_token="...", chat_id="...")],
    dashboard_prefix="/admin/logs",
    dashboard_token="secret",    # omit to disable the dashboard entirely
    skip_paths=["/healthz"],     # extra paths the middleware ignores
)
```

The dashboard's own traffic is never logged, so live tail can't flood itself.

### Alert sinks

```python
from nahiarhdLOG.alerter import Rule, SmtpSink, TelegramSink, WebhookSink

rules = [Rule("api-errors", count=10, window_seconds=600, cooldown_seconds=1800)]
sinks = [
    WebhookSink("https://hooks.example/deploy"),          # POSTs {"subject","body"} as JSON
    TelegramSink(bot_token="123:ABC", chat_id="-100..."),  # Bot API sendMessage
    SmtpSink("smtp.example.com", ["ops@example.com"], username="bot", password="..."),
]
```

Rules evaluate in a background thread; a failing sink never blocks the others.

### OpenTelemetry export (optional)

```bash
pip install "nahiarhdlog[otel]"
```

```python
from nahiarhdLOG.otel import export_trace
from nahiarhdLOG.query import get_trace

export_trace(get_trace(collector.storage, trace_id))  # keeps the original trace id
```

## Example app

```bash
# terminal 1: run the demo
uv run python examples/basic_app.py serve

# terminal 2: generate traffic
uv run python examples/basic_app.py traffic --n 300
```

Open `http://127.0.0.1:8000/admin/logs` with token `demo-token`.

## FAQ

**Which Python versions?** 3.10+ (3.10, 3.11, 3.12 tested in CI).

**Where is data stored?** One SQLite file (`db_path`), WAL mode, FTS5 index for search. Delete the file to wipe everything. Set `retention_days` for automatic purging.

**Is the dashboard secure?** It is mounted only when `dashboard_token` is set, and every page + API call requires the token (query param or `Authorization: Bearer`). Without it you get a lock screen (401). Use a long random token and HTTPS in production.

**Why don't I see the dashboard's own requests in the logs?** By design: the dashboard prefix is auto-excluded so its polling doesn't drown your signal. Add more with `skip_paths`.

**What's the overhead?** Requests only enqueue a small dict; SQLite writes happen in batches on a background thread. Run `python scripts/probe_perf.py` to measure on your machine.

**Flask / Django / plain scripts?** On the roadmap. The core (`collector`, `storage`, `query`, `alerter`, `metrics`) imports no web framework — only the thin `adapters/` layer does, enforced by an automated boundary test.

**How do I disable the dashboard?** Omit `dashboard_token` (default): nothing is mounted.

## Roadmap

- [x] Core logging, SQLite+FTS5 storage, search API
- [x] Error tracker + webhook alerts
- [x] Metrics + tracing (+ optional OpenTelemetry export)
- [x] Embedded dashboard UI
- [ ] Flask/Django adapters
- [ ] Postgres storage backend

## Development

```bash
uv pip install -e ".[dev,otel]"
uv run --no-sync python -m pytest   # run via python -m (see note below)
uv run --no-sync python scripts/probe_perf.py --n 10000
```

> Note (macOS quirk, this machine): something on this Mac re-applies the Finder's `hidden` flag to dot-directory contents, which makes CPython silently skip `.pth` files and breaks console-script entry points in `.venv`. Running tests via `python -m` (imports from the source tree) is immune, as are regular installs and CI. If a console script ever reports `ModuleNotFoundError`, run `chflags -R nohidden .venv` and prefer `python -m`.

## Changelog

- **0.1.3** — Dashboard login persists via cookie: refresh and new tabs stay signed in; lock screen signs in without putting the token in the URL; old `?token=` bookmarks keep working and migrate to a cookie. Added Lock button. Shutdown hook moved to lifespan composition (works alongside user-defined lifespans, Starlette 0.52–1.x).
- **0.1.2** — Requests capture client IP + user agent; detail dialog rebuilt (no empty rows, status chips, "view full trace" jump); log rows keyboard-accessible (Tab + Enter).
- **0.1.1** — `NahiarhdHandler` no longer appends a second traceback when the message already contains one (loguru-style pre-formatted records, manually formatted tracebacks).
- **0.1.0** — Initial release: searchable logs, error tracker + alerts, metrics, tracing, embedded dashboard.

## License

MIT — see [LICENSE](LICENSE).

By [Raihan Hidayatullah Djunaedi](https://github.com/nahiarhd) · [nahiarhd.com](https://nahiarhd.com) · PyPI [@nahiarhd](https://pypi.org/user/nahiarhd/)
