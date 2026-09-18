"""nahiarhdlog: embedded observability for FastAPI."""

from __future__ import annotations

from typing import Any

from .attach import attach
from .collector import Collector
from .span import AISpan, Span, ai_span, span

__version__ = "0.7.0"
__all__ = ["__version__", "AISpan", "Collector", "Span", "ai_span", "attach", "observe", "span"]


def __getattr__(name: str) -> Any:
    # Lazy so `import nahiarhdLOG` never requires FastAPI; only the
    # framework adapter does.
    if name == "observe":
        from .adapters.fastapi import observe

        return observe
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
