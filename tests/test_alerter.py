import time

import pytest

from nahiarhdLOG.alerter import (
    Alerter,
    Rule,
    SmtpSink,
    TelegramSink,
    WebhookSink,
)
from nahiarhdLOG.collector import Collector
from nahiarhdLOG.query import top_errors
from nahiarhdLOG.storage import SQLiteStorage


class FakeClock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now

    def advance(self, seconds):
        self.now += seconds


class MemorySink:
    def __init__(self, fail=False):
        self.sent = []
        self.fail = fail

    def send(self, subject, body):
        if self.fail:
            raise ConnectionError("sink down")
        self.sent.append((subject, body))


def _error(message="boom", sig="ValueError@a.py:1"):
    return {
        "type": "error",
        "level": "CRITICAL",
        "message": message,
        "trace_id": None,
        "data": {"signature": sig},
    }


def test_rule_fires_once_at_threshold():
    clock, sink = FakeClock(), MemorySink()
    a = Alerter(
        [Rule("r", count=3, window_seconds=60, cooldown_seconds=60)],
        [sink],
        clock=clock,
    )
    for _ in range(2):
        a._process(_error())
    assert sink.sent == []
    a._process(_error())
    assert len(sink.sent) == 1
    assert "ValueError@a.py:1" in sink.sent[0][1]


def test_cooldown_suppresses_repeat_burst():
    clock, sink = FakeClock(), MemorySink()
    a = Alerter(
        [Rule("r", count=2, window_seconds=60, cooldown_seconds=60)],
        [sink],
        clock=clock,
    )
    a._process(_error())
    a._process(_error())
    assert len(sink.sent) == 1
    clock.advance(10)
    a._process(_error())
    a._process(_error())
    assert len(sink.sent) == 1, "cooldown must suppress the second burst"
    clock.advance(60)
    a._process(_error())
    a._process(_error())
    assert len(sink.sent) == 2, "fresh count after cooldown must fire again"


def test_window_expiry_requires_fresh_hits():
    clock, sink = FakeClock(), MemorySink()
    a = Alerter(
        [Rule("r", count=2, window_seconds=10, cooldown_seconds=0)],
        [sink],
        clock=clock,
    )
    a._process(_error())
    clock.advance(30)
    a._process(_error())
    assert sink.sent == [], "stale hits must not combine with new ones"


def test_non_matching_events_ignored():
    clock, sink = FakeClock(), MemorySink()
    a = Alerter(
        [Rule("r", count=1, window_seconds=60, cooldown_seconds=0)],
        [sink],
        clock=clock,
    )
    a._process({"type": "log", "message": "x", "data": {}})
    a._process({"type": "request", "message": "x", "data": {}})
    assert sink.sent == []


def test_failing_sink_does_not_block_others():
    clock = FakeClock()
    bad, good = MemorySink(fail=True), MemorySink()
    a = Alerter(
        [Rule("r", count=1, window_seconds=60, cooldown_seconds=0)],
        [bad, good],
        clock=clock,
    )
    a._process(_error())
    assert len(good.sent) == 1


def test_webhook_sink_posts_json(monkeypatch):
    calls = []

    class Resp:
        def raise_for_status(self):
            pass

    def fake_post(url, json=None, headers=None, timeout=None):
        calls.append((url, json, headers))
        return Resp()

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)
    WebhookSink("https://hooks.example/x", headers={"k": "v"}).send("S", "B")
    assert calls == [("https://hooks.example/x", {"subject": "S", "body": "B"}, {"k": "v"})]


def test_telegram_sink_hits_send_message(monkeypatch):
    calls = []

    class Resp:
        def raise_for_status(self):
            pass

    def fake_post(url, json=None, timeout=None):
        calls.append((url, json))
        return Resp()

    import httpx

    monkeypatch.setattr(httpx, "post", fake_post)
    TelegramSink("TOKEN", "123").send("S", "B")
    (url, payload), *_ = calls
    assert url == "https://api.telegram.org/botTOKEN/sendMessage"
    assert payload == {"chat_id": "123", "text": "S\nB"}


def test_smtp_sink_sends_message(monkeypatch):
    sent = []

    class FakeSMTP:
        def __init__(self, host, port, timeout=None):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

        def starttls(self):
            pass

        def login(self, u, p):
            pass

        def send_message(self, msg):
            sent.append(msg)

    import smtplib

    monkeypatch.setattr(smtplib, "SMTP", FakeSMTP)
    SmtpSink("smtp.example", ["to@example"], username="u", password="p").send("S", "B")
    assert len(sent) == 1
    assert sent[0]["Subject"] == "S"
    assert sent[0]["To"] == "to@example"


def test_collector_routes_errors_to_alerter(tmp_path):
    sink = MemorySink()
    alerter = Alerter(
        [Rule("r", count=1, window_seconds=60, cooldown_seconds=0)], [sink]
    ).start()
    collector = Collector(str(tmp_path / "t.db"), alerter=alerter).start()
    try:
        collector.emit(_error())
        deadline = time.monotonic() + 5
        while not sink.sent and time.monotonic() < deadline:
            time.sleep(0.02)
        assert len(sink.sent) == 1
    finally:
        collector.stop()
        alerter.stop()


def test_top_errors_groups_by_signature(tmp_path):
    s = SQLiteStorage(str(tmp_path / "t.db"))
    try:
        for _ in range(3):
            s.insert_many([_error(sig="ValueError@a.py:1")])
        s.insert_many([_error(sig="KeyError@b.py:2")])
        s.insert_many([{"type": "log", "level": "INFO", "message": "x"}])
        top = top_errors(s)
        assert [(t["signature"], t["count"]) for t in top] == [
            ("ValueError@a.py:1", 3),
            ("KeyError@b.py:2", 1),
        ]
    finally:
        s.close()
