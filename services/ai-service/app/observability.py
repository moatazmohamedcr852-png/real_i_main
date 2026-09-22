from __future__ import annotations

import json
import logging
import time
from typing import Any


SAFE_FIELDS = {"request_id", "event", "operation", "outcome", "latency_ms", "course_id", "document_id", "chunk_count", "model", "provider", "status_code", "error_name", "error_code", "actor_id", "agent"}


def configure_logger(level: str) -> logging.Logger:
    logger = logging.getLogger("real_i.ai")
    if not logger.handlers:
        handler = logging.StreamHandler()
        handler.setFormatter(logging.Formatter("%(message)s"))
        logger.addHandler(handler)
    logger.setLevel(level)
    logger.propagate = False
    return logger


def log_event(logger: logging.Logger, **fields: Any) -> None:
    """Log only explicitly allow-listed operational metadata."""
    safe = {name: value for name, value in fields.items() if name in SAFE_FIELDS and value is not None}
    logger.info(json.dumps(safe, default=str, separators=(",", ":")))


def elapsed_ms(started: float) -> int:
    return round((time.perf_counter() - started) * 1000)
