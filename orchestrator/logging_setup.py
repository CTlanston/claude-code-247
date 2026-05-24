"""Structured logging.

Logs are emitted both to stderr (human-readable) and to the SQLite ``logs``
table (machine-readable). The latter powers ``claude247 logs search``.

For M1 we keep this minimal: a small wrapper around the stdlib ``logging``
module with a JSON formatter. The DB sink lands in M7 when the log indexer
ships; calls placed now will be retained.
"""
from __future__ import annotations

import json
import logging
import sys
from typing import Any


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "ts": self.formatTime(record, "%Y-%m-%dT%H:%M:%S"),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        extras = {
            k: v for k, v in record.__dict__.items()
            if k not in ("name", "msg", "args", "levelname", "levelno", "pathname", "filename",
                          "module", "exc_info", "exc_text", "stack_info", "lineno", "funcName",
                          "created", "msecs", "relativeCreated", "thread", "threadName",
                          "processName", "process", "getMessage", "message")
        }
        if extras:
            payload["extra"] = extras
        return json.dumps(payload, sort_keys=True)


def get_logger(name: str = "claude247", level: int = logging.INFO) -> logging.Logger:
    """Return a singleton logger; configures handlers on first call."""
    logger = logging.getLogger(name)
    if logger.handlers:
        return logger
    logger.setLevel(level)
    h = logging.StreamHandler(sys.stderr)
    h.setFormatter(JsonFormatter())
    logger.addHandler(h)
    logger.propagate = False
    return logger
