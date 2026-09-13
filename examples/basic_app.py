"""Demo app for nahiarhdlog.

Serve the demo (terminal 1):
    uv run python examples/basic_app.py serve

Generate traffic (terminal 2):
    uv run python examples/basic_app.py traffic --n 300

Then open the dashboard:
    http://127.0.0.1:8000/admin/logs   (token: demo-token)
"""

from __future__ import annotations

import argparse
import logging
import random
import time

from fastapi import FastAPI

from nahiarhdLOG import observe

log = logging.getLogger("demo")
TOKEN = "demo-token"


def build_app(db_path: str = "demo.db") -> FastAPI:
    app = FastAPI(title="nahiarhdlog demo")
    observe(app, db_path=db_path, dashboard_token=TOKEN)

    @app.get("/")
    def index():
        log.info("index visited")
        return {"app": "nahiarhdlog demo", "dashboard": "/admin/logs"}

    @app.get("/ping")
    def ping():
        return {"ok": True}

    @app.get("/users/{user_id}")
    def user(user_id: int):
        log.info("fetching user %d", user_id)
        if user_id <= 0:
            log.warning("odd user_id requested: %d", user_id)
        time.sleep(random.uniform(0.005, 0.05))
        return {"id": user_id}

    @app.get("/boom")
    def boom():
        log.error("about to explode")
        raise RuntimeError("demo explosion (on purpose)")

    return app


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run(build_app(args.db), host=args.host, port=args.port)


def cmd_traffic(args: argparse.Namespace) -> None:
    import httpx

    paths = ["/", "/ping", "/users/7", "/users/0", "/boom", "/nope"]
    weights = [10, 40, 25, 5, 5, 5]
    ok = err = 0
    with httpx.Client(base_url=args.base, timeout=10) as client:
        for _ in range(args.n):
            path = random.choices(paths, weights=weights)[0]
            try:
                r = client.get(path)
                if r.status_code < 500:
                    ok += 1
                else:
                    err += 1
            except httpx.HTTPError:
                err += 1
    print(f"sent {args.n}: ok={ok} err={err}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__)
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("serve", help="run the demo server")
    s.add_argument("--host", default="127.0.0.1")
    s.add_argument("--port", type=int, default=8000)
    s.add_argument("--db", default="demo.db")
    t = sub.add_parser("traffic", help="hit a running demo server")
    t.add_argument("--n", type=int, default=200)
    t.add_argument("--base", default="http://127.0.0.1:8000")
    args = ap.parse_args()
    logging.basicConfig(level=logging.INFO)
    {"serve": cmd_serve, "traffic": cmd_traffic}[args.cmd](args)


if __name__ == "__main__":
    main()
