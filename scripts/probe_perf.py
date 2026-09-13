"""Perf probe: raw-ASGI timing of the middleware overhead.

Runs N requests against a bare app and an observed app, reports mean/p95
for both plus the overhead, and exits non-zero if the p95 overhead budget
(5 ms default) is exceeded.
"""

import argparse
import asyncio
import statistics
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from fastapi import FastAPI  # noqa: E402

from nahiarhdLOG import observe  # noqa: E402

BUDGET_MS = 5.0


def make_app(observed: bool, db_path: str) -> FastAPI:
    app = FastAPI()

    @app.get("/ping")
    def ping():
        return {"ok": True}

    if observed:
        observe(app, db_path=db_path)
    return app


async def one(app: FastAPI) -> None:
    scope = {
        "type": "http",
        "http_version": "1.1",
        "method": "GET",
        "path": "/ping",
        "query_string": b"",
        "headers": [],
        "client": ("test", 50000),
        "server": ("test", 80),
        "scheme": "http",
    }
    sent_request = False

    async def receive():
        nonlocal sent_request
        if sent_request:
            await asyncio.sleep(3600)
        sent_request = True
        return {"type": "http.request", "body": b"", "more_body": False}

    async def send(message):
        pass

    await app(scope, receive, send)


async def bench(app: FastAPI, n: int, warmup: int) -> list[float]:
    for _ in range(warmup):
        await one(app)
    out = []
    for _ in range(n):
        import time

        t0 = time.perf_counter()
        await one(app)
        out.append((time.perf_counter() - t0) * 1000)
    return out


def pct(data: list[float], q: float) -> float:
    data = sorted(data)
    return data[min(len(data) - 1, int(len(data) * q))]


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--n", type=int, default=10_000)
    ap.add_argument("--warmup", type=int, default=500)
    ap.add_argument("--budget-ms", type=float, default=BUDGET_MS)
    args = ap.parse_args()

    with tempfile.TemporaryDirectory() as tmp:
        bare = make_app(False, f"{tmp}/bare.db")
        obs = make_app(True, f"{tmp}/obs.db")
        bare_times = asyncio.run(bench(bare, args.n, args.warmup))
        obs_times = asyncio.run(bench(obs, args.n, args.warmup))

    def report(name: str, times: list[float]) -> None:
        print(
            f"{name}: mean={statistics.mean(times):.3f}ms"
            f" p50={pct(times, 0.50):.3f}ms p95={pct(times, 0.95):.3f}ms"
            f" n={len(times)}"
        )

    report("bare    ", bare_times)
    report("observed", obs_times)
    overhead = pct(obs_times, 0.95) - pct(bare_times, 0.95)
    print(f"p95 overhead: {overhead:.3f}ms (budget {args.budget_ms:.1f}ms)")
    if overhead > args.budget_ms:
        print("FAIL: overhead exceeds budget")
        return 1
    print("PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
