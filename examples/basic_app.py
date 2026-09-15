"""Demo app for nahiarhdlog.

Serve the demo (terminal 1):
    uv run python examples/basic_app.py serve

Generate traffic (terminal 2):
    uv run python examples/basic_app.py traffic --n 300

Then open the dashboard:
    http://127.0.0.1:8000/nahiarhdlog   (token: demo-token)
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
        return {"app": "nahiarhdlog demo", "dashboard": "/nahiarhdlog"}

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

    @app.delete("/documents/{file_id}")
    def delete_document(file_id: str):
        log.info("Deleted document %s (%s)", file_id, "kontrak.pdf")
        return {"id": file_id, "ok": True}

    @app.delete("/folders/{folder_id}")
    def delete_folder(folder_id: str):
        log.info("Deleted folder %s (%s)", folder_id, "Hukum")
        return {"id": folder_id, "ok": True}

    @app.patch("/documents/{file_id}")
    def update_document(file_id: str):
        log.info("Updated document %s (%s)", file_id, "kontrak.pdf")
        return {"id": file_id, "ok": True}

    return app


def cmd_serve(args: argparse.Namespace) -> None:
    import uvicorn

    uvicorn.run(build_app(args.db), host=args.host, port=args.port)


def cmd_traffic(args: argparse.Namespace) -> None:
    import httpx

    ops = [
        ("GET", "/", 10),
        ("GET", "/ping", 28),
        ("GET", "/users/7", 16),
        ("GET", "/users/0", 4),
        ("GET", "/boom", 4),
        ("GET", "/nope", 4),
        ("DELETE", "/documents/doc-42", 12),
        ("DELETE", "/folders/fld-7", 8),
        ("PATCH", "/documents/doc-42", 6),
        ("DELETE", "/nope", 2),
    ]
    population = [(m, p) for m, p, _ in ops]
    weights = [w for _, _, w in ops]
    ok = err = 0
    with httpx.Client(base_url=args.base, timeout=10) as client:
        for _ in range(args.n):
            method, path = random.choices(population, weights=weights)[0]
            try:
                r = client.request(method, path)
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
