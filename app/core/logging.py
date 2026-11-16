"""Structured logging that never emits secrets, tokens, URIs, or file contents."""
from __future__ import annotations

import logging
import sys
from datetime import UTC, datetime
from typing import Any

from app.core.security import mask_uri_in_text

SENSITIVE_KEYS = {
    "password", "new_password", "token", "access_token", "refresh_token",
    "authorization", "cookie", "set-cookie", "uri", "encrypted_uri",
    "app_db_uri", "secret", "fernet_key", "app_secret_key", "file", "content",
}


def _scrub(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            k: ("[REDACTED]" if k.lower() in SENSITIVE_KEYS else _scrub(v))
            for k, v in value.items()
        }
    if isinstance(value, (list, tuple)):
        return [_scrub(v) for v in value]
    if isinstance(value, str):
        return mask_uri_in_text(value)
    return value


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        entry: dict[str, Any] = {
            "ts": datetime.now(UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "msg": mask_uri_in_text(record.getMessage()),
        }
        extra = getattr(record, "ctx", None)
        if extra:
            entry["ctx"] = _scrub(extra)
        if record.exc_info and record.exc_info[0]:
            entry["exc"] = self.formatException(record.exc_info)[-2000:]
        return json_dumps(entry)


def json_dumps(entry: dict[str, Any]) -> str:
    import json
    return json.dumps(entry, default=str, ensure_ascii=False)


def configure_logging(level: int = logging.INFO) -> None:
    root = logging.getLogger()
    root.setLevel(level)
    root.handlers.clear()
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(JSONFormatter())
    root.addHandler(handler)
    for noisy in ("uvicorn.access", "motor.core", "pymongo"):
        logging.getLogger(noisy).setLevel(logging.WARNING)


def get_logger(name: str) -> logging.LoggerAdapter:
    return logging.LoggerAdapter(logging.getLogger(name), extra={})
