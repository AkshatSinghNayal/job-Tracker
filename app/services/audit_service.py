"""Audit log: ids and metadata only — never credentials, URIs, or file contents."""
from __future__ import annotations

from datetime import UTC, datetime
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

COLLECTION = "audit_log"


async def audit(db: AsyncIOMotorDatabase, action: str, ip: str = "", **ids: Any) -> None:
    entry: dict[str, Any] = {
        "action": action,
        "at": datetime.now(UTC),
        "ip": ip,
    }
    entry.update({k: v for k, v in ids.items() if v is not None})
    try:
        await db[COLLECTION].insert_one(entry)
    except Exception:  # auditing must never break the request
        pass
