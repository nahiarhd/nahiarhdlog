# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

A mix, with no dominant type (confirmed): developers who ship their own FastAPI app and check what it did in production; small teams that want history and search without running ELK or a SaaS; engineers answering an alert (Telegram, webhook, email) who need the failing request and its traceback fast; and builders of AI/LLM apps who read agent runs as spans with models, tokens, prompts, and tool calls. They open the dashboard inside their own app at `/nahiarhdlog`, often alongside their editor or terminal, sometimes for seconds after a deploy, sometimes for an hour with live tail running.

## Product Purpose

nahiarhdlog is embedded observability for FastAPI: searchable logs, error grouping and alerts, request metrics, and tracing, with a token-locked dashboard served by the app itself. Success is a developer answering "what just happened, and why" without leaving their app or standing up infrastructure.

## Positioning

The observability lives inside the app it watches. One `pip install` and one `observe(app)` call; events go to one SQLite file (or one shared Postgres table for replicas); the dashboard is a route of the app, behind the app's own token. Metrics are derived from the same request events the logs show, so the numbers can never disagree with the evidence.

## Operating Context

- Mounted at a configurable prefix (default `/nahiarhdlog`) of the host app; locked screen until the token is entered (cookie afterwards).
- All four jobs are frequent and must stay one click away (confirmed): live-tailing logs while developing, investigating errors (signature → traceback → trace), reading AI/agent traces (request → spans → logs, tokens, prompts), and checking health after a deploy (throughput, error rate, p50/p95 latency). The user welcomes additional views or features that serve these jobs.
- Used next to an editor, terminal, and the app's own UI; theme must follow the OS setting by default, with both light and dark fully finished, plus a manual toggle.
- Event types: `log`, `request`, `error`, `span`. Levels: DEBUG, INFO, WARNING, ERROR, CRITICAL. Spans have kinds such as llm, tool, embedding, agent, db, cache, http, auth, custom.
- Backends: per-process SQLite (replicas each see their own data; the UI warns on backend switches) or shared Postgres.

## Capabilities and Constraints

- Dashboard is static files shipped inside the Python package (`nahiarhdLOG/dashboard/static/`), served by FastAPI. Vanilla HTML/CSS/JS, no build step.
- No external network dependencies at runtime: dashboards may run on closed networks, so fonts, scripts, and icons ship with the package (inferred from the zero-infrastructure positioning; not explicitly pinned by the user).
- JSON API under `{prefix}/api/` (logs with filters and pagination, event detail, top error signatures, traces with summary, metrics overview, health). Data is retained for `retention_days` (default 7).
- Sensitive values (auth headers, cookies, token/password fields) arrive already redacted; the UI must never re-expose the dashboard token in URLs.

## Brand Commitments

- The name **nahiarhdlog** stays (confirmed). The logo/mark may be redesigned (confirmed); everything else about the look is open.

## Evidence on Hand

- `README.md` (setup, features, FAQ), `docs/dashboard.png` (screenshot of the previous dashboard), `examples/basic_app.py` and `examples/ai_agent_tracing.py` (demo traffic generators).
- No customers, testimonials, benchmarks beyond the README's stated overhead numbers, or pricing exist; none may be invented.

## Product Principles

1. Evidence first: every number links to the events behind it, and every event shows its full context (trace, payload, traceback) one step away.
2. Fast to the answer: the path from "something broke" to the failing line is as short as the data allows.
3. Embedded and self-contained: nothing outside the app is required to run, read, or trust the dashboard.
4. Honest under load: dropped events, backlog, backend switches, and empty states are stated plainly, never hidden.
