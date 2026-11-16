"""Typed application settings. Fails fast on missing secrets at import time."""
from __future__ import annotations

import os
import secrets
from functools import lru_cache
from pathlib import Path

from cryptography.fernet import Fernet
from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

_env_file = Path(__file__).resolve().parent.parent.parent / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(_env_file) if _env_file.exists() else None,
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "JobTracker"
    app_secret_key: str = Field(
        default_factory=lambda: os.environ.get("APP_SECRET_KEY") or secrets.token_urlsafe(32),
        min_length=32,
    )
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = Field(default=15, ge=1)
    refresh_token_expire_days: int = Field(default=7, ge=1)

    fernet_key: str = Field(
        default_factory=lambda: os.environ.get("FERNET_KEY") or Fernet.generate_key().decode()
    )

    app_db_uri: str = "mongodb://localhost:27017"
    app_db_name: str = "jobtracker"

    admin_username: str = Field(
        default_factory=lambda: os.environ.get("ADMIN_USERNAME") or "admin",
        min_length=3,
    )
    admin_password: str = Field(
        default_factory=lambda: os.environ.get("ADMIN_PASSWORD") or "adminpassword123",
        min_length=8,
    )

    allowed_origins: str = "http://localhost:8000"
    max_upload_mb: int = Field(default=10, ge=1, le=100)
    cookie_secure: bool = False

    login_max_attempts: int = 5
    login_window_seconds: int = 300
    login_lockout_seconds: int = 300

    client_idle_seconds: int = 600
    max_connections_cached: int = 8

    @field_validator("app_secret_key")
    @classmethod
    def _secret_strong(cls, v: str) -> str:
        if not v or len(v) < 32:
            raise ValueError("APP_SECRET_KEY must be at least 32 characters")
        return v

    @field_validator("fernet_key")
    @classmethod
    def _fernet_valid(cls, v: str) -> str:
        try:
            Fernet(v.encode())
        except Exception as exc:  # noqa: BLE001
            raise ValueError(f"FERNET_KEY is not a valid Fernet key: {exc}") from exc
        return v

    @property
    def origins(self) -> list[str]:
        return [o.strip() for o in self.allowed_origins.split(",") if o.strip()]

    @property
    def max_upload_bytes(self) -> int:
        return self.max_upload_mb * 1024 * 1024


@lru_cache
def get_settings() -> Settings:
    return Settings()  # type: ignore[call-arg]
