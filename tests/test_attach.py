"""Process-level attach(): capture logs without a FastAPI app."""

from __future__ import annotations

import logging
import subprocess
import sys
from pathlib import Path

import pytest

from nahiarhdLOG import attach
from nahiarhdLOG.handler import NahiarhdHandler


def _detach(collector) -> None:
    root = logging.getLogger()
    for handler in list(root.handlers):
        if isinstance(handler, NahiarhdHandler) and handler.collector is collector:
            root.removeHandler(handler)
            handler.close()
    collector.stop()


@pytest.fixture()
def attached(tmp_path):
    collector = attach(str(tmp_path / "t.db"))
    try:
        yield collector
    finally:
        _detach(collector)


def test_attach_captures_stdlib_log(attached):
    logging.getLogger("nahiarhdlog.test.attach.basic").info("from-worker")
    assert attached.flush()
    rows = attached.storage.search(text="from-worker")
    assert len(rows) == 1
    assert rows[0]["type"] == "log"
    assert rows[0]["level"] == "INFO"
    assert "source" not in rows[0]["data"]


def test_attach_optional_source(tmp_path):
    collector = attach(str(tmp_path / "t.db"), source="embeddings")
    try:
        logging.getLogger("nahiarhdlog.test.attach.source").warning("tagged")
        assert collector.flush()
        rows = collector.storage.search(text="tagged")
        assert len(rows) == 1
        assert rows[0]["data"]["source"] == "embeddings"
        assert rows[0]["type"] == "log"
    finally:
        _detach(collector)


def test_child_process_logs_show_up_in_the_same_db(tmp_path):
    db = str(tmp_path / "shared.db")
    parent = attach(db, source="api")
    child = tmp_path / "child.py"
    child.write_text(
        "import logging\n"
        "from nahiarhdLOG import attach\n"
        f"c = attach({db!r}, source='worker')\n"
        "logging.getLogger('child').error('from-child-process')\n"
        "assert c.flush()\n"
    )
    try:
        subprocess.run(
            [sys.executable, str(child)],
            check=True,
            cwd=str(Path(__file__).resolve().parent.parent),
        )
        rows = parent.storage.search(text="from-child-process")
        assert len(rows) == 1
        assert rows[0]["data"]["source"] == "worker"
        assert rows[0]["type"] == "log"
    finally:
        _detach(parent)


def test_attach_import_does_not_need_fastapi():
    import nahiarhdLOG.attach as mod

    assert not hasattr(mod, "fastapi")
    assert not hasattr(mod, "FastAPI")
