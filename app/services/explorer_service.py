"""Read-only Data Explorer with a strict operator whitelist and safe BSON serialization."""
from __future__ import annotations

import base64
import re
from datetime import datetime
from typing import Any

from bson import Binary, Decimal128, ObjectId
from fastapi import HTTPException
from motor.motor_asyncio import AsyncIOMotorClient

QUERY_MAX_MS = 5000
MAX_PAGE_SIZE = 100
MAX_FILTER_DEPTH = 6

ALLOWED_OPERATORS: set[str] = {
    "$and", "$or", "$nor", "$not",
    "$eq", "$ne", "$gt", "$gte", "$lt", "$lte", "$in", "$nin",
    "$exists", "$type", "$size", "$all", "$elemMatch",
    "$regex", "$options", "$mod",
}
BLOCKED_OPERATORS = {
    "$where", "$function", "$accumulator", "$expr", "$let",
    "$map", "$filter", "$reduce", "$unionWith", "$merge", "$out",
    "$lookup", "$graphLookup", "$sample", "$collStats",
}

_NAME_RE = re.compile(r"^[^$/\\.\x00]{1,255}$")


def _validate_name(name: str, kind: str) -> str:
    if not name or not _NAME_RE.match(name):
        raise HTTPException(400, f"Invalid {kind} name")
    return name


def validate_filter(obj: Any, depth: int = 0) -> Any:
    """Reject JS/agg operators, allow a safe whitelist, convert $oid/$date."""
    if depth > MAX_FILTER_DEPTH:
        raise HTTPException(400, "Filter nested too deeply")
    if isinstance(obj, dict):
        if len(obj) > 50:
            raise HTTPException(400, "Filter too large")
        out: dict[str, Any] = {}
        for key, value in obj.items():
            if not isinstance(key, str):
                raise HTTPException(400, "Filter keys must be strings")
            if key in BLOCKED_OPERATORS:
                raise HTTPException(400, f"Operator {key} is not allowed")
            if key.startswith("$") and key not in ALLOWED_OPERATORS:
                raise HTTPException(400, f"Operator {key} is not allowed")
            out[key] = validate_filter(value, depth + 1)
        return out
    if isinstance(obj, list):
        if len(obj) > 100:
            raise HTTPException(400, "Filter array too large")
        return [validate_filter(v, depth + 1) for v in obj]
    if isinstance(obj, str):
        return obj
    if isinstance(obj, (bool, int, float)) or obj is None:
        return obj
    raise HTTPException(400, f"Unsupported filter value type: {type(obj).__name__}")


def convert_extended(obj: Any) -> Any:
    """Convert {"$oid": ...} / {"$date": ...} placeholders into real BSON values."""
    if isinstance(obj, dict):
        if len(obj) == 1:
            if "$oid" in obj:
                try:
                    return ObjectId(obj["$oid"])
                except Exception as exc:
                    raise HTTPException(400, "Invalid $oid value") from exc
            if "$date" in obj:
                value = obj["$date"]
                try:
                    if isinstance(value, str):
                        return datetime.fromisoformat(value.replace("Z", "+00:00"))
                    return datetime.fromtimestamp(int(value) / 1000)
                except Exception as exc:
                    raise HTTPException(400, "Invalid $date value") from exc
        return {k: convert_extended(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [convert_extended(v) for v in obj]
    return obj


def parse_filter(raw: dict) -> dict:
    return convert_extended(validate_filter(raw))


def serialize(value: Any) -> Any:
    """Safely serialize BSON values for JSON output."""
    if isinstance(value, ObjectId):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Decimal128):
        return str(value.to_decimal())
    if isinstance(value, Binary):
        return {"$binary": base64.b64encode(value.data).decode(), "subtype": str(value.subtype)}
    if isinstance(value, bytes):
        return {"$binary": base64.b64encode(value).decode()}
    if isinstance(value, dict):
        return {str(k): serialize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [serialize(v) for v in value]
    return value


def validate_sort(sort: str) -> list[tuple[str, int]]:
    """Sort spec: 'field:-1,other:1' (max 3 keys)."""
    if not sort.strip():
        return [("_id", -1)]
    keys: list[tuple[str, int]] = []
    for part in sort.split(",")[:3]:
        bits = part.strip().split(":")
        field = _validate_name(bits[0], "sort field")
        direction = -1 if len(bits) > 1 and bits[1].strip() == "-1" else 1
        keys.append((field, direction))
    return keys


async def list_databases(client: AsyncIOMotorClient) -> list[str]:
    names = await client.list_database_names()
    return sorted(names)


async def list_collections(client: AsyncIOMotorClient, db_name: str) -> list[dict]:
    _validate_name(db_name, "database")
    db = client[db_name]
    out: list[dict] = []
    for name in await db.list_collection_names():
        coll = db[name]
        count = await coll.estimated_document_count(maxTimeMS=QUERY_MAX_MS)
        try:
            indexes = [
                {"name": idx.get("name", ""), "key": serialize(idx.get("key", {}))}
                for idx in (await coll.index_information()).values()
            ]
        except Exception:  # noqa: BLE001
            indexes = []
        out.append({"name": name, "estimated_count": count, "indexes": indexes})
    return sorted(out, key=lambda c: c["name"])


async def find_documents(
    client: AsyncIOMotorClient,
    db_name: str,
    coll_name: str,
    mongo_filter: dict,
    sort: list[tuple[str, int]],
    page: int,
    page_size: int,
) -> dict:
    _validate_name(db_name, "database")
    _validate_name(coll_name, "collection")
    page = max(1, page)
    page_size = min(max(1, page_size), MAX_PAGE_SIZE)
    coll = client[db_name][coll_name]
    total = await coll.count_documents(mongo_filter, maxTimeMS=QUERY_MAX_MS)
    cursor = (
        coll.find(mongo_filter, maxTimeMS=QUERY_MAX_MS)
        .sort(sort)
        .skip((page - 1) * page_size)
        .limit(page_size)
    )
    docs = [serialize(doc) async for doc in cursor]
    return {"total": total, "page": page, "page_size": page_size, "documents": docs}


async def get_document(
    client: AsyncIOMotorClient, db_name: str, coll_name: str, doc_id: str
) -> dict | None:
    _validate_name(db_name, "database")
    _validate_name(coll_name, "collection")
    try:
        object_id: Any = ObjectId(doc_id)
    except Exception:
        object_id = doc_id
    doc = await client[db_name][coll_name].find_one({"_id": object_id}, maxTimeMS=QUERY_MAX_MS)
    return serialize(doc) if doc else None


async def schema_sample(
    client: AsyncIOMotorClient, db_name: str, coll_name: str
) -> dict:
    _validate_name(db_name, "database")
    _validate_name(coll_name, "collection")
    cursor = client[db_name][coll_name].find({}, maxTimeMS=QUERY_MAX_MS).limit(100)
    fields: dict[str, dict[str, int]] = {}
    count = 0
    async for doc in cursor:
        count += 1
        for key, value in doc.items():
            type_name = type(value).__name__ if value is not None else "null"
            stats = fields.setdefault(key, {})
            stats[type_name] = stats.get(type_name, 0) + 1
    return {
        "sampled": count,
        "fields": {
            key: {"types": sorted(types), "present_in": sum(types.values())}
            for key, types in sorted(fields.items())
        },
    }
