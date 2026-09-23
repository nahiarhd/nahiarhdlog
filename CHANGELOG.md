# Changelog

All notable changes to `nahiarhdlog` will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.1] - 2026-09-23

### Fixed
- The "reached a different backend" banner no longer fires on Postgres-backed deployments, where every replica reads the same events. `/api/health` reports `shared_storage` from the storage's new `shared` flag (`SQLiteStorage.shared = False`, `PostgresStorage.shared = True`; custom storages without it are treated as per-process).

## [0.8.0] - 2026-09-21

### Added
- **Shared Postgres storage (`nahiarhdLOG.PostgresStorage`, `pip install nahiarhdlog[postgres]`):** point `db_path` at a `postgresql://` URL and every replica reads and writes one `nahiarhdlog_events` table — the dashboard stops flip-flopping between per-pod SQLite files and traces resolve on the first click. SQLite stays the zero-infrastructure default for plain paths.
- `Collector` reconnects once and retries after a dropped Postgres connection instead of failing permanently; use-after-`close()` raises immediately.
- CI runs the Postgres backend suite against a `postgres:16` service.

## [0.7.1] - 2026-09-21

### Fixed
- Dashboard reads wait for the queued backlog (`Collector.flush_pending`) so just-emitted errors appear on the first click instead of after repeated clicks.
- Dashboard API responses send `Cache-Control: no-store` — a cached `[]` is indistinguishable from "no data".
- Error-card clicks no longer fire duplicate log requests; stale out-of-order responses are dropped via request generations in `app.js`.
- Text-search FTS fallback preserves all other filters (type/level/signature/...) instead of returning a wrong unfiltered superset; transient lock errors now surface instead of silently degrading into different results.

### Added
- `/api/health` reports the backend `instance` (`host`/`pid`), shown in the dashboard footer with a warning banner when consecutive calls reach different backends (multi-replica round-robin).

## [0.7.0] - 2026-09-21

### Added
- **Interactive Trace Waterfall UI:** Visual timeline waterfall rendering parent-child span execution, relative timing offsets, duration bars, and aggregate trace metrics.
- **Hierarchical Trace Tree View:** Visual branch guide lines (`└─`) and depth nesting for HTTP requests, AI agents, LLM synthesis, tool calls, vector embeddings, databases, and caches.
- **HTTP Request & Response Body Inspection:** Non-destructive ASGI stream interception capturing request payloads and response bodies with configurable size limits (`max_body_size`).
- **AI Agent Tracing API (`nahiarhdLOG.span`, `nahiarhdLOG.ai_span`):** Context managers and decorators capturing LLM parameters (model, prompt, completion, system prompt, tokens, tool calls) and embedding steps.
- **Dedicated Payload Viewers:** Formatted JSON viewer with copy buttons for requests, responses, model outputs, and tool call arguments.
- **Color-Coded Operation Badges:** Visual badges and timeline bar colors for `[REQ]`, `[AGENT]`, `[LLM]`, `[TOOL]`, `[EMBED]`, `[DB]`, `[CACHE]`, `[HTTP]`, `[AUTH]`, and `[ERROR]`.
- **Sensitive Credential Redaction:** Automatic redaction of passwords, bearer tokens, API keys, and authorization secrets in request/response bodies and headers.

### Changed
- `observe(app)` accepts `capture_body: bool = True` and `max_body_size: int = 65536` parameters.
- `/api/traces/{trace_id}` endpoint returns computed trace summary metrics alongside events.
- Root HTTP requests are timestamped from execution start for accurate chronological timeline alignment.

### Fixed
- Fixed premature database shutdown in demo app by replacing TestClient lifespan runner with background daemon seeding.

---

## [0.6.3] - 2026-09-18
- Initial release with embedded SQLite logging, error tracking, alerts, and metrics.
