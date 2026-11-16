"""In-memory login rate limiting: per-IP and per-username, with lockout."""
from __future__ import annotations

import time

from app.core.config import get_settings


class LoginRateLimiter:
    def __init__(self) -> None:
        self._attempts: dict[str, list[float]] = {}
        self._locked_until: dict[str, float] = {}

    def _settings(self):
        return get_settings()

    def is_locked(self, ip: str, username: str) -> bool:
        now = time.monotonic()
        for key in (f"ip:{ip}", f"user:{username.lower()}"):
            if self._locked_until.get(key, 0) > now:
                return True
        return False

    def record_failure(self, ip: str, username: str) -> None:
        s = self._settings()
        now = time.monotonic()
        for key in (f"ip:{ip}", f"user:{username.lower()}"):
            bucket = [t for t in self._attempts.get(key, []) if now - t < s.login_window_seconds]
            bucket.append(now)
            self._attempts[key] = bucket
            if len(bucket) >= s.login_max_attempts:
                self._locked_until[key] = now + s.login_lockout_seconds
                self._attempts[key] = []

    def reset(self, ip: str, username: str) -> None:
        for key in (f"ip:{ip}", f"user:{username.lower()}"):
            self._attempts.pop(key, None)
            self._locked_until.pop(key, None)


rate_limiter = LoginRateLimiter()
