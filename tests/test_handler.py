import logging

import pytest

from nahiarhdLOG.collector import Collector
from nahiarhdLOG.handler import NahiarhdHandler, install_excepthook
from nahiarhdLOG.middleware import current_trace_id


@pytest.fixture()
def collector(tmp_path):
    c = Collector(str(tmp_path / "t.db")).start()
    yield c
    c.stop()


def test_handler_forwards_record(collector):
    handler = NahiarhdHandler(collector, level=logging.INFO)
    log = logging.getLogger("nahiarhdlog.test.forward")
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        log.info("hello-handler")
    finally:
        log.removeHandler(handler)
    assert collector.flush()
    rows = collector.storage.search(text="hello-handler")
    assert len(rows) == 1
    assert rows[0]["level"] == "INFO"
    assert rows[0]["type"] == "log"
    assert rows[0]["data"]["logger"] == "nahiarhdlog.test.forward"


def test_handler_respects_level(collector):
    handler = NahiarhdHandler(collector, level=logging.WARNING)
    log = logging.getLogger("nahiarhdlog.test.level")
    log.addHandler(handler)
    log.setLevel(logging.DEBUG)
    try:
        log.info("too-quiet")
        log.warning("loud-enough")
    finally:
        log.removeHandler(handler)
    assert collector.flush()
    assert collector.storage.count(text="too-quiet") == 0
    assert collector.storage.count(text="loud-enough") == 1


def test_handler_marks_exception_as_error(collector):
    handler = NahiarhdHandler(collector)
    log = logging.getLogger("nahiarhdlog.test.exc")
    log.addHandler(handler)
    try:
        try:
            raise ValueError("boom-marker")
        except ValueError:
            log.exception("failed hard")
    finally:
        log.removeHandler(handler)
    assert collector.flush()
    rows = collector.storage.search(text="boom-marker")
    assert len(rows) == 1
    assert rows[0]["type"] == "error"
    assert "Traceback" in rows[0]["message"]


def test_handler_skips_second_traceback_when_preformatted(collector):
    # Loguru-style: exc_info set AND message already carries a traceback.
    handler = NahiarhdHandler(collector)
    log = logging.getLogger("nahiarhdlog.test.pretb")
    log.addHandler(handler)
    log.setLevel(logging.DEBUG)
    try:
        try:
            raise KeyError("k9")
        except KeyError:
            log.error(
                "it-broke\nTraceback (most recent call last):\n  File \"x\", line 1\nKeyError: k9",
                exc_info=True,
            )
    finally:
        log.removeHandler(handler)
    assert collector.flush()
    rows = collector.storage.search(text="it-broke")
    assert len(rows) == 1
    assert rows[0]["message"].count("Traceback (most recent call last)") == 1
    assert rows[0]["type"] == "error"
    assert rows[0]["data"]["exc_type"] == "KeyError"
    assert rows[0]["data"]["signature"].startswith("KeyError@test_handler.py:")


def test_handler_keeps_stdlib_extra(collector):
    handler = NahiarhdHandler(collector)
    log = logging.getLogger("nahiarhdlog.test.extra")
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    try:
        log.info("with-extra", extra={"user_id": "u-9", "task_id": 12})
    finally:
        log.removeHandler(handler)
    assert collector.flush()
    rows = collector.storage.search(text="with-extra")
    assert rows[0]["data"]["user_id"] == "u-9"
    assert rows[0]["data"]["task_id"] == 12
    assert rows[0]["data"]["logger"] == "nahiarhdlog.test.extra"


def test_handler_attaches_trace_id(collector):
    handler = NahiarhdHandler(collector)
    log = logging.getLogger("nahiarhdlog.test.trace")
    log.addHandler(handler)
    log.setLevel(logging.INFO)
    token = current_trace_id.set("trace-abc")
    try:
        log.info("traced-message")
    finally:
        current_trace_id.reset(token)
        log.removeHandler(handler)
    assert collector.flush()
    rows = collector.storage.search(text="traced-message")
    assert rows[0]["trace_id"] == "trace-abc"


def test_thread_excepthook_captures(collector, monkeypatch):
    import threading

    chained = []
    monkeypatch.setattr(threading, "excepthook", lambda args: chained.append(args))
    install_excepthook(collector)

    def boom() -> None:
        raise RuntimeError("thread-hook-marker")

    thread = threading.Thread(target=boom)
    thread.start()
    thread.join()
    assert collector.flush()
    assert chained, "previous threading.excepthook was not chained"
    rows = collector.storage.search(text="thread-hook-marker")
    assert len(rows) == 1
    assert rows[0]["type"] == "error"
    assert rows[0]["data"]["origin"] == "thread_excepthook"


def test_excepthook_chains_and_captures(collector, monkeypatch):
    import sys

    calls = []
    monkeypatch.setattr(sys, "excepthook", lambda *a: calls.append(a))
    install_excepthook(collector)
    try:
        raise RuntimeError("hook-marker")
    except RuntimeError as e:
        sys.excepthook(type(e), e, e.__traceback__)
    assert collector.flush()
    assert calls, "previous excepthook was not chained"
    rows = collector.storage.search(text="hook-marker")
    assert len(rows) == 1
    assert rows[0]["type"] == "error"
