"""Threshold alerting with cooldown.

Framework-agnostic: this module must never import FastAPI/Starlette.
Windows are in-memory; a restart resets counters (documented behavior).
"""

from __future__ import annotations

import queue
import smtplib
import threading
import time
from collections import deque
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Any, Callable

import httpx

_TELEGRAM_API = "https://api.telegram.org"
_HTTP_TIMEOUT = 10.0


@dataclass(frozen=True)
class Rule:
    """Fire when `count` matching events arrive within `window_seconds`."""

    name: str
    count: int = 5
    window_seconds: float = 300.0
    cooldown_seconds: float = 3600.0
    event_type: str = "error"


class AlertSink:
    def send(self, subject: str, body: str) -> None:
        raise NotImplementedError


class WebhookSink(AlertSink):
    """POST `{"subject": ..., "body": ...}` as JSON to any URL."""

    def __init__(self, url: str, headers: dict[str, str] | None = None) -> None:
        self.url = url
        self.headers = headers or {}

    def send(self, subject: str, body: str) -> None:
        resp = httpx.post(
            self.url,
            json={"subject": subject, "body": body},
            headers=self.headers,
            timeout=_HTTP_TIMEOUT,
        )
        resp.raise_for_status()


class TelegramSink(AlertSink):
    """Send via Telegram Bot API `sendMessage`."""

    def __init__(self, bot_token: str, chat_id: str | int) -> None:
        self.bot_token = bot_token
        self.chat_id = chat_id

    def send(self, subject: str, body: str) -> None:
        text = f"{subject}\n{body}"[:4000]
        resp = httpx.post(
            f"{_TELEGRAM_API}/bot{self.bot_token}/sendMessage",
            json={"chat_id": self.chat_id, "text": text},
            timeout=_HTTP_TIMEOUT,
        )
        resp.raise_for_status()


class SmtpSink(AlertSink):
    """Send via SMTP (stdlib only)."""

    def __init__(
        self,
        host: str,
        to_addrs: list[str],
        from_addr: str = "nahiarhdlog@localhost",
        port: int = 587,
        username: str | None = None,
        password: str | None = None,
        use_tls: bool = True,
    ) -> None:
        self.host = host
        self.port = port
        self.to_addrs = to_addrs
        self.from_addr = from_addr
        self.username = username
        self.password = password
        self.use_tls = use_tls

    def send(self, subject: str, body: str) -> None:
        msg = EmailMessage()
        msg["Subject"] = subject
        msg["From"] = self.from_addr
        msg["To"] = ", ".join(self.to_addrs)
        msg.set_content(body)
        with smtplib.SMTP(self.host, self.port, timeout=_HTTP_TIMEOUT) as smtp:
            if self.use_tls:
                smtp.starttls()
            if self.username:
                smtp.login(self.username, self.password or "")
            smtp.send_message(msg)


@dataclass
class _RuleState:
    hits: deque[float] = field(default_factory=deque)
    last_fired: float = 0.0


class Alerter:
    """Background evaluator: rules x sinks, never blocks the caller."""

    def __init__(
        self,
        rules: list[Rule],
        sinks: list[AlertSink],
        queue_size: int = 1000,
        clock: Callable[[], float] | None = None,
    ) -> None:
        self.rules = list(rules)
        self.sinks = list(sinks)
        self._clock = clock or time.monotonic
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=queue_size)
        self._states = {r.name: _RuleState() for r in self.rules}
        self._stop = threading.Event()
        self._started = False
        self._thread = threading.Thread(
            target=self._run, name="nahiarhdlog-alerter", daemon=True
        )

    def start(self) -> Alerter:
        if self._started:
            return self
        self._started = True
        self._thread.start()
        return self

    def notify(self, event: dict[str, Any]) -> None:
        try:
            self._queue.put_nowait(event)
        except queue.Full:
            pass

    def stop(self, timeout: float = 10.0) -> None:
        if not self._started:
            return
        self._started = False
        self._stop.set()
        self._thread.join(timeout=timeout)

    def _run(self) -> None:
        while not self._stop.is_set():
            try:
                event = self._queue.get(timeout=0.2)
            except queue.Empty:
                continue
            try:
                self._process(event)
            except Exception:
                pass

    def _process(self, event: dict[str, Any]) -> None:
        now = self._clock()
        for rule in self.rules:
            if event.get("type") != rule.event_type:
                continue
            state = self._states[rule.name]
            state.hits.append(now)
            while state.hits and state.hits[0] <= now - rule.window_seconds:
                state.hits.popleft()
            if len(state.hits) < rule.count:
                continue
            if now - state.last_fired < rule.cooldown_seconds:
                continue
            state.last_fired = now
            state.hits.clear()
            self._fire(rule, event, now)

    def _fire(self, rule: Rule, event: dict[str, Any], now: float) -> None:
        data = event.get("data") or {}
        sig = data.get("signature", "(unknown)")
        subject = (
            f"[nahiarhdlog] {rule.name}: "
            f"{rule.count} errors in {rule.window_seconds:.0f}s"
        )
        body = f"Latest: {sig}\n{(event.get('message') or '')[:500]}"
        for sink in self.sinks:
            try:
                sink.send(subject, body)
            except Exception:
                continue
