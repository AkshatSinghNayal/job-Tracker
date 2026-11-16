"""Motor client lifecycle: app database handle + pooled client cache for saved connections."""
from __future__ import annotations

import time
from typing import Any

from motor.motor_asyncio import (
    AsyncIOMotorClient,
    AsyncIOMotorCollection,
    AsyncIOMotorDatabase,
    AsyncIOMotorGridFSBucket,
)

from app.core.config import get_settings
from app.core.logging import get_logger

log = get_logger(__name__)

_app_client: AsyncIOMotorClient | None = None


async def connect_app_db() -> AsyncIOMotorDatabase:
    global _app_client
    settings = get_settings()
    _app_client = AsyncIOMotorClient(
        settings.app_db_uri,
        serverSelectionTimeoutMS=5000,
        uuidRepresentation="standard",
    )
    await _app_client.admin.command("ping")  # fail fast if unreachable
    return _app_client[settings.app_db_name]


async def close_app_db() -> None:
    global _app_client
    if _app_client is not None:
        _app_client.close()
        _app_client = None


def get_app_db() -> AsyncIOMotorDatabase:
    if _app_client is None:
        raise RuntimeError("App database not initialised")
    return _app_client[get_settings().app_db_name]


def get_app_client() -> AsyncIOMotorClient:
    if _app_client is None:
        raise RuntimeError("App database not initialised")
    return _app_client


def gridfs_bucket(db: AsyncIOMotorDatabase) -> AsyncIOMotorGridFSBucket:
    return AsyncIOMotorGridFSBucket(db)


class ClientCache:
    """Pooled motor clients keyed by connection id, with idle eviction."""

    def __init__(self) -> None:
        self._clients: dict[str, tuple[AsyncIOMotorClient, float]] = {}
        self._uris: dict[str, str] = {}

    async def get(self, conn_id: str, uri: str) -> AsyncIOMotorClient:
        settings = get_settings()
        self._evict_idle(settings.client_idle_seconds)
        entry = self._clients.get(conn_id)
        if entry and self._uris.get(conn_id) == uri:
            self._clients[conn_id] = (entry[0], time.monotonic())
            return entry[0]
        if entry:  # URI changed for this id: drop old client
            entry[0].close()
            self._clients.pop(conn_id, None)
        while len(self._clients) >= settings.max_connections_cached:
            oldest = min(self._clients, key=lambda k: self._clients[k][1])
            self._clients.pop(oldest)[0].close()
            log.info("evicted idle mongo client", extra={"ctx": {"connection_id": oldest}})
        client = AsyncIOMotorClient(
            uri, serverSelectionTimeoutMS=5000, uuidRepresentation="standard"
        )
        self._clients[conn_id] = (client, time.monotonic())
        self._uris[conn_id] = uri
        return client

    def _evict_idle(self, idle_seconds: int) -> None:
        now = time.monotonic()
        for key in [k for k, (_, ts) in self._clients.items() if now - ts > idle_seconds]:
            self._clients.pop(key)[0].close()
            self._uris.pop(key, None)

    async def close_all(self) -> None:
        for client, _ in self._clients.values():
            client.close()
        self._clients.clear()
        self._uris.clear()


client_cache = ClientCache()


def collection(db: AsyncIOMotorDatabase, name: str) -> AsyncIOMotorCollection:
    return db[name]


def doc_id(value: Any) -> str:
    return str(value)
