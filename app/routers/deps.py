"""Shared FastAPI dependencies."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends, Header, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorDatabase

from app.core.security import TokenError
from app.db.mongo import get_app_db
from app.services.auth_service import verify_access
from app.services.connection_service import connection_db_for


async def get_current_user(
    authorization: Annotated[str | None, Header()] = None,
) -> str:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = await verify_access(authorization[7:])
    except TokenError as exc:
        raise HTTPException(status_code=401, detail=str(exc)) from exc
    return str(payload["sub"])


CurrentUser = Annotated[str, Depends(get_current_user)]


async def get_workspace_db(
    x_connection_id: Annotated[str | None, Header()] = None,
) -> AsyncIOMotorDatabase:
    """Active workspace: the app database, or a saved connection via X-Connection-Id."""
    if x_connection_id and x_connection_id != "app":
        return await connection_db_for(get_app_db(), x_connection_id)
    return get_app_db()


WorkspaceDB = Annotated[AsyncIOMotorDatabase, Depends(get_workspace_db)]


def client_ip(request: Request) -> str:
    return request.client.host if request.client else "unknown"
