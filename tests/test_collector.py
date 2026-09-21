import time

from nahiarhdLOG.collector import Collector


def test_flush_pending_idle_returns_immediately(tmp_path):
    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        start = time.monotonic()
        assert collector.flush_pending(timeout=2.0) is True
        assert time.monotonic() - start < 1.0
    finally:
        collector.stop()


def test_flush_pending_waits_for_queued_events(tmp_path):
    collector = Collector(str(tmp_path / "t.db")).start()
    try:
        for i in range(5):
            assert collector.emit({"type": "log", "message": f"m{i}", "data": {}})
        assert collector.flush_pending(timeout=5.0) is True
        assert collector.storage.count() == 5
    finally:
        collector.stop()


def test_flush_pending_times_out_when_writer_stopped(tmp_path):
    collector = Collector(str(tmp_path / "t.db"))  # never started: nothing drains
    assert collector.emit({"type": "log", "message": "x", "data": {}})
    start = time.monotonic()
    assert collector.flush_pending(timeout=0.2) is False
    assert time.monotonic() - start < 2.0
