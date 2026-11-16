"""Saved MongoDB connections API. URIs are encrypted at rest and never returned."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request

from app.db.mongo import get_app_db
from app.routers.deps import CurrentUser, client_ip
from app.schemas.connection import ConnectionCreate, ConnectionOut, ConnectionTestResult
from app.services import connection_service
from app.services.audit_service import audit

router = APIRouter(prefix="/api/connections", tags=["connections"])


def _masked(conn: dict) -> ConnectionOut:
    return ConnectionOut(
        id=conn["id"],
        name=conn["name"],
        masked_uri="•••••• (credentials stored encrypted)",
        read_only=conn["read_only"],
        created_at=conn["created_at"],
        last_used_at=conn.get("last_used_at"),
    )


@router.post("", status_code=201)
async def create_connection(
    body: ConnectionCreate, user: CurrentUser, request: Request
) -> dict:
    app_db = get_app_db()
    try:
        conn_id = await connection_service.create_connection(app_db, body)
    except connection_service.ConnectionError_ as exc:
        raise HTTPException(503, exc.message) from exc
    await audit(app_db, "connection.add", ip=client_ip(request), connection_id=conn_id)
    return {"id": conn_id}


@router.get("", response_model=list[ConnectionOut])
async def list_connections(user: CurrentUser) -> list[ConnectionOut]:
    return [_masked(conn) for conn in await connection_service.list_connections(get_app_db())]


@router.post("/{conn_id}/test", response_model=ConnectionTestResult)
async def test_connection(conn_id: str, user: CurrentUser) -> ConnectionTestResult:
    try:
        result = await connection_service.test_connection(get_app_db(), conn_id)
    except connection_service.ConnectionError_ as exc:
        raise HTTPException(503, exc.message) from exc
    return ConnectionTestResult(**result)


@router.delete("/{conn_id}")
async def delete_connection(conn_id: str, user: CurrentUser, request: Request) -> dict:
    app_db = get_app_db()
    try:
        ok = await connection_service.delete_connection(app_db, conn_id)
    except connection_service.ConnectionError_ as exc:
        raise HTTPException(400, exc.message) from exc
    if not ok:
        raise HTTPException(404, "Connection not found")
    await audit(app_db, "connection.delete", ip=client_ip(request), connection_id=conn_id)
    return {"ok": True}
