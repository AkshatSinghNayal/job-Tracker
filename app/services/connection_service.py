"""Saved MongoDB connections: encrypted-at-rest URIs, ping-before-save, pooled clients."""
from __future__ import annotations

import time
import uuid
from datetime import UTC, datetime

from motor.motor_asyncio import AsyncIOMotorClient, AsyncIOMotorDatabase
from pymongo.errors import PyMongoError

from app.core.config import get_settings
from app.core.logging import get_logger
from app.core.security import decrypt_secret, encrypt_secret, mask_uri_in_text
from app.db.mongo import client_cache
from app.schemas.connection import ConnectionCreate

log = get_logger(__name__)
COLLECTION = "connections"
DEFAULT_CONN_ID = "default"


class ConnectionError_(Exception):
    def __init__(self, message: str) -> None:
        self.message = mask_uri_in_text(message)
        super().__init__(self.message)


async def _ping(uri: str) -> tuple[int, str]:
    """Return (latency_ms, server_version); raise with masked error text on failure."""
    start = time.perf_counter()
    client = AsyncIOMotorClient(uri, serverSelectionTimeoutMS=5000)
    try:
        info = await client.server_info()
        latency = int((time.perf_counter() - start) * 1000)
        return latency, info.get("version", "unknown")
    except PyMongoError as exc:
        raise ConnectionError_(f"Could not connect: {mask_uri_in_text(str(exc))}") from exc
    finally:
        client.close()


async def create_connection(app_db: AsyncIOMotorDatabase, data: ConnectionCreate) -> str:
    # Validate format + reachability BEFORE saving anything.
    await _ping(data.uri)
    conn_id = uuid.uuid4().hex
    await app_db[COLLECTION].insert_one(
        {
            "_id": conn_id,
            "name": data.name,
            "encrypted_uri": encrypt_secret(data.uri),
            "read_only": data.read_only,
            "created_at": datetime.now(UTC),
            "last_used_at": None,
        }
    )
    log.info("connection added", extra={"ctx": {"connection_id": conn_id, "name": data.name}})
    return conn_id


async def list_connections(app_db: AsyncIOMotorDatabase) -> list[dict]:
    settings = get_settings()
    out = [
        {
            "id": DEFAULT_CONN_ID,
            "name": f"Primary Database ({settings.app_db_name}) [env: APP_DB_URI]",
            "read_only": True,
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
            "last_used_at": datetime.now(UTC),
            "has_credentials": True,
            "is_default": True,
        }
    ]
    cursor = app_db[COLLECTION].find({}, {"encrypted_uri": 0}).sort("created_at", 1)
    async for doc in cursor:
        out.append(
            {
                "id": str(doc["_id"]),
                "name": doc["name"],
                "read_only": doc.get("read_only", True),
                "created_at": doc["created_at"],
                "last_used_at": doc.get("last_used_at"),
                "has_credentials": True,
                "is_default": False,
            }
        )
    return out


async def get_connection(app_db: AsyncIOMotorDatabase, conn_id: str) -> dict | None:
    if conn_id == DEFAULT_CONN_ID:
        settings = get_settings()
        return {
            "_id": DEFAULT_CONN_ID,
            "name": f"Primary Database ({settings.app_db_name})",
            "encrypted_uri": encrypt_secret(settings.app_db_uri),
            "read_only": True,
            "created_at": datetime(2026, 1, 1, tzinfo=UTC),
            "last_used_at": datetime.now(UTC),
            "is_default": True,
        }
    return await app_db[COLLECTION].find_one({"_id": conn_id})


async def delete_connection(app_db: AsyncIOMotorDatabase, conn_id: str) -> bool:
    if conn_id == DEFAULT_CONN_ID:
        raise ConnectionError_("Cannot delete primary database configured via APP_DB_URI")
    result = await app_db[COLLECTION].delete_one({"_id": conn_id})
    if result.deleted_count:
        log.info("connection deleted", extra={"ctx": {"connection_id": conn_id}})
    return result.deleted_count > 0


async def get_client_for(app_db: AsyncIOMotorDatabase, conn_id: str) -> AsyncIOMotorClient:
    if conn_id == DEFAULT_CONN_ID:
        from app.db.mongo import get_app_client

        return get_app_client()
    conn = await get_connection(app_db, conn_id)
    if conn is None:
        raise ConnectionError_("Connection not found")
    uri = decrypt_secret(conn["encrypted_uri"])  # plaintext only in memory
    client = await client_cache.get(conn_id, uri)
    await app_db[COLLECTION].update_one(
        {"_id": conn_id}, {"$set": {"last_used_at": datetime.now(UTC)}}
    )
    return client


async def test_connection(app_db: AsyncIOMotorDatabase, conn_id: str) -> dict:
    if conn_id == DEFAULT_CONN_ID:
        latency, version = await _ping(get_settings().app_db_uri)
        return {"ok": True, "latency_ms": latency, "server_version": version}
    conn = await get_connection(app_db, conn_id)
    if conn is None:
        raise ConnectionError_("Connection not found")
    uri = decrypt_secret(conn["encrypted_uri"])
    latency, version = await _ping(uri)
    return {"ok": True, "latency_ms": latency, "server_version": version}


async def connection_db_for(app_db: AsyncIOMotorDatabase, conn_id: str) -> AsyncIOMotorDatabase:
    """Database handle on a saved connection's cluster, using APP_DB_NAME (active workspace)."""
    client = await get_client_for(app_db, conn_id)
    return client[get_settings().app_db_name]
