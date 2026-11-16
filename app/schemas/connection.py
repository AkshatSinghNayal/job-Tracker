from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field, field_validator

_MONGO_SCHEMES = ("mongodb://", "mongodb+srv://")


class ConnectionCreate(BaseModel):
    name: str = Field(min_length=1, max_length=100)
    uri: str = Field(min_length=12, max_length=2000)
    read_only: bool = True

    @field_validator("uri")
    @classmethod
    def _valid_scheme(cls, v: str) -> str:
        v = v.strip()
        if not v.startswith(_MONGO_SCHEMES):
            raise ValueError("URI must start with mongodb:// or mongodb+srv://")
        return v


class ConnectionOut(BaseModel):
    id: str
    name: str
    masked_uri: str
    read_only: bool
    created_at: datetime
    last_used_at: datetime | None


class ConnectionTestResult(BaseModel):
    ok: bool
    latency_ms: int
    server_version: str
