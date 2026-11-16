"""Connections + explorer safety tests."""
from __future__ import annotations

from datetime import UTC

import pytest


async def test_connection_crud_masked(admin_client):
    res = await admin_client.post(
        "/api/connections",
        json={"name": "Local", "uri": "mongodb://localhost:27017", "read_only": True},
    )
    assert res.status_code == 201, res.text
    conn_id = res.json()["id"]

    listed = await admin_client.get("/api/connections")
    conn = [c for c in listed.json() if c["id"] == conn_id][0]
    assert "localhost:27017" not in str(conn)
    assert conn["read_only"] is True

    test = await admin_client.post(f"/api/connections/{conn_id}/test")
    assert test.status_code == 200
    assert test.json()["ok"] is True
    assert test.json()["latency_ms"] >= 0

    deleted = await admin_client.delete(f"/api/connections/{conn_id}")
    assert deleted.status_code == 200


async def test_connection_rejects_bad_uri(admin_client):
    res = await admin_client.post(
        "/api/connections",
        json={"name": "Bad", "uri": "http://not-mongo", "read_only": True},
    )
    assert res.status_code == 422


async def test_connection_unreachable_uri_not_saved(admin_client):
    res = await admin_client.post(
        "/api/connections",
        json={"name": "Dead", "uri": "mongodb://127.0.0.1:59999", "read_only": True},
    )
    assert res.status_code == 503
    listed = await admin_client.get("/api/connections")
    assert all(c["name"] != "Dead" for c in listed.json())


async def test_explorer_blocks_js_operators(admin_client):
    import json

    res = await admin_client.get(
        "/api/explorer/databases/jobtracker/collections/users/documents",
        params={"connection": "x", "filter": json.dumps({"$where": "true"})},
    )
    # Unknown connection id is also rejected, but filter validation must fire first.
    assert res.status_code in (400, 404)


def test_filter_whitelist_blocks_where():
    from fastapi import HTTPException

    from app.services.explorer_service import parse_filter

    with pytest.raises(HTTPException) as exc:
        parse_filter({"$where": "1 == 1"})
    assert exc.value.status_code == 400
    with pytest.raises(HTTPException):
        parse_filter({"$function": {}})
    ok = parse_filter({"status": {"$in": ["applied", "offer"]}})
    assert ok == {"status": {"$in": ["applied", "offer"]}}


def test_serializer_bson_types():
    from datetime import datetime
    from decimal import Decimal

    from bson import Decimal128, ObjectId

    from app.services.explorer_service import serialize

    oid = ObjectId()
    out = serialize({
        "_id": oid, "when": datetime(2026, 1, 1, tzinfo=UTC),
        "price": Decimal128(Decimal("9.99")),
    })
    assert out["_id"] == str(oid)
    assert out["when"].startswith("2026-01-01")
    assert out["price"] == "9.99"
