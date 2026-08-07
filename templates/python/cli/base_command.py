from __future__ import annotations

import time
from abc import ABC, abstractmethod

import structlog

logger = structlog.get_logger()


class BaseCommand(ABC):
    """Every command subclasses this. run() carries the logic; __call__ wraps
    it with automatic start/completed/failed structured logging."""

    command_name: str

    @abstractmethod
    def run(self, **kwargs) -> None: ...

    def __call__(self, **kwargs) -> None:
        log = logger.bind(command=self.command_name)
        start = time.monotonic()
        log.info("started", **kwargs)
        try:
            self.run(**kwargs)
        except Exception as exc:
            duration_ms = round((time.monotonic() - start) * 1000, 1)
            log.error("failed", error=str(exc), duration_ms=duration_ms)
            raise
        duration_ms = round((time.monotonic() - start) * 1000, 1)
        log.info("completed", duration_ms=duration_ms)
