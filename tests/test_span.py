import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

import nahiarhdLOG
from nahiarhdLOG import ai_span, observe, span
from nahiarhdLOG.collector import Collector


def test_span_basic_lifecycle(tmp_path):
    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        with span("database_query", span_type="db", collector=collector, input_data={"sql": "SELECT 1"}) as s:
            s.set_output({"rows": 1})
            s.set_attribute("table", "users")

        assert collector.flush()
        rows = collector.storage.search(event_type="span")
        assert len(rows) == 1
        data = rows[0]["data"]
        assert data["name"] == "database_query"
        assert data["span_type"] == "db"
        assert data["status"] == "ok"
        assert data["input"] == {"sql": "SELECT 1"}
        assert data["output"] == {"rows": 1}
        assert data["table"] == "users"
        assert data["duration_ms"] >= 0
        assert rows[0]["trace_id"]
        assert rows[0]["level"] == "INFO"
    finally:
        collector.stop()


def test_ai_span_attributes(tmp_path):
    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        with ai_span(
            "chat_completion",
            model="gpt-4o",
            messages=[{"role": "user", "content": "What is 2+2?"}],
            system_prompt="You are a math assistant.",
            collector=collector,
        ) as ai:
            ai.set_completion("2 + 2 = 4")
            ai.set_tokens(prompt_tokens=15, completion_tokens=8)
            ai.set_tool_calls([{"name": "calculator", "args": {"expr": "2+2"}}])

        assert collector.flush()
        rows = collector.storage.search(event_type="span")
        assert len(rows) == 1
        data = rows[0]["data"]
        assert data["name"] == "chat_completion"
        assert data["span_type"] == "llm"
        assert data["model"] == "gpt-4o"
        assert data["system_prompt"] == "You are a math assistant."
        assert data["messages"] == [{"role": "user", "content": "What is 2+2?"}]
        assert data["completion"] == "2 + 2 = 4"
        assert data["prompt_tokens"] == 15
        assert data["completion_tokens"] == 8
        assert data["total_tokens"] == 23
        assert data["tool_calls"] == [{"name": "calculator", "args": {"expr": "2+2"}}]
        assert "gpt-4o" in rows[0]["message"]
        assert "23 tokens" in rows[0]["message"]
    finally:
        collector.stop()


def test_span_nesting_and_parent_propagation(tmp_path):
    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        with span("root_agent", span_type="agent", collector=collector) as root:
            with ai_span("llm_reasoning", model="claude-3-5-sonnet", collector=collector) as step1:
                step1.set_completion("I should search docs")
            with span("tool_search", span_type="tool", collector=collector) as step2:
                step2.set_output(["doc1", "doc2"])

        assert collector.flush()
        # Oldest first: step1, step2, root_agent (since root finishes last)
        rows = collector.storage.search(event_type="span")
        assert len(rows) == 3

        by_name = {r["data"]["name"]: r for r in rows}
        root_row = by_name["root_agent"]
        step1_row = by_name["llm_reasoning"]
        step2_row = by_name["tool_search"]

        # All share the exact same trace_id
        assert root_row["trace_id"] == step1_row["trace_id"] == step2_row["trace_id"]
        # Children point to root as parent_span_id
        assert step1_row["data"]["parent_span_id"] == root_row["data"]["span_id"]
        assert step2_row["data"]["parent_span_id"] == root_row["data"]["span_id"]
    finally:
        collector.stop()


def test_span_exception_recording(tmp_path):
    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        with pytest.raises(ValueError, match="test error"):
            with span("failing_step", collector=collector):
                raise ValueError("test error")

        assert collector.flush()
        rows = collector.storage.search(event_type="span")
        assert len(rows) == 1
        row = rows[0]
        assert row["data"]["status"] == "error"
        assert row["data"]["error"]["exc_type"] == "ValueError"
        assert row["data"]["error"]["exc_message"] == "test error"
        assert row["level"] == "ERROR"
        assert "error: test error" in row["message"]
    finally:
        collector.stop()


def test_span_integrates_with_fastapi_trace(tmp_path):
    app = FastAPI()

    @app.post("/api/proxy/v1/responses")
    def proxy(payload: dict):
        with ai_span("agent_response", model="gpt-4o") as ai:
            ai.set_completion("AI output here")
            ai.set_tokens(prompt_tokens=50, completion_tokens=25)
        return {"output": "AI output here"}

    collector = observe(app, db_path=str(tmp_path / "t.db"), capture_body=True)
    with TestClient(app) as client:
        res = client.post("/api/proxy/v1/responses", json={"prompt": "hello"})
        assert res.status_code == 200
        assert collector.flush()

        req_events = collector.storage.search(event_type="request")
        span_events = collector.storage.search(event_type="span")

        assert len(req_events) == 1
        assert len(span_events) == 1

        # The internal AI span automatically joined the HTTP request's trace_id!
        assert span_events[0]["trace_id"] == req_events[0]["trace_id"]
        assert span_events[0]["data"]["model"] == "gpt-4o"
        assert span_events[0]["data"]["total_tokens"] == 75


def test_async_span_and_decorator(tmp_path):
    import asyncio

    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        @span("async_task", span_type="task", collector=collector)
        async def do_work(x: int):
            return x * 2

        result = asyncio.run(do_work(21))
        assert result == 42
        assert collector.flush()

        rows = collector.storage.search(event_type="span")
        assert len(rows) == 1
        assert rows[0]["data"]["name"] == "async_task"
    finally:
        collector.stop()


def test_decorator_runs_each_call_in_a_fresh_span(tmp_path):
    # Regression: one Span instance was shared by every call, so a single
    # failure marked every later call "error" and outputs leaked across.
    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        @span("work", collector=collector)
        def work(fail):
            if fail:
                raise ValueError("boom")
            return "done"

        with pytest.raises(ValueError):
            work(True)
        assert work(False) == "done"
        assert collector.flush()
        rows = list(reversed(collector.storage.search(event_type="span")))
        assert [r["data"]["status"] for r in rows] == ["error", "ok"]
        assert "error" not in rows[1]["data"]
        assert rows[0]["data"]["span_id"] != rows[1]["data"]["span_id"]
    finally:
        collector.stop()


def test_concurrent_async_decorator_calls(tmp_path):
    # Regression: overlapping calls reset each other's ContextVar tokens
    # ("Token was created in a different Context").
    import asyncio

    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        @span("io", collector=collector)
        async def io(i):
            await asyncio.sleep(0.01)
            return i

        async def main():
            return await asyncio.gather(*(io(i) for i in range(5)))

        assert asyncio.run(main()) == [0, 1, 2, 3, 4]
        assert collector.flush()
        rows = collector.storage.search(event_type="span")
        assert len(rows) == 5
        assert len({r["data"]["span_id"] for r in rows}) == 5
    finally:
        collector.stop()


def test_spans_and_logs_nest_under_the_request(tmp_path):
    import logging

    app = FastAPI()
    log = logging.getLogger("nest-test")

    @app.get("/work")
    def work():
        with span("step") as s:
            log.warning("inside step")
        log.warning("inside request")
        return {"ok": True}

    collector = observe(app, db_path=str(tmp_path / "t.db"))
    with TestClient(app) as client:
        assert client.get("/work").status_code == 200
        assert collector.flush()
        req = collector.storage.search(event_type="request")[0]
        step = collector.storage.search(event_type="span")[0]
        logs = {r["message"]: r for r in collector.storage.search(event_type="log", text="inside")}
        request_span = req["data"]["span_id"]
        assert step["data"]["parent_span_id"] == request_span
        assert logs["inside step"]["data"]["parent_span_id"] == step["data"]["span_id"]
        assert logs["inside request"]["data"]["parent_span_id"] == request_span
