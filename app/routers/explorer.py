"""Data Explorer API: strictly read-only browsing of a saved connection."""
from __future__ import annotations

from fastapi import APIRouter, HTTPException, Query

from app.db.mongo import get_app_db
from app.routers.deps import CurrentUser
from app.services import connection_service, explorer_service

router = APIRouter(prefix="/api/explorer", tags=["explorer"])


async def _client_for(conn_id: str):
    try:
        return await connection_service.get_client_for(get_app_db(), conn_id)
    except connection_service.ConnectionError_ as exc:
        raise HTTPException(404, exc.message) from exc


async def _read_only_client(conn_id: str):
    if conn_id == "default":
        from app.db.mongo import get_app_client

        return get_app_client()
    conn = await connection_service.get_connection(get_app_db(), conn_id)
    if conn is None:
        raise HTTPException(404, "Connection not found")
    # The explorer never issues writes; the read_only flag is surfaced to the UI.
    return await _client_for(conn_id)


@router.get("/databases")
async def databases(conn_id: str = Query(alias="connection"), user: CurrentUser = None) -> list[str]:
    client = await _read_only_client(conn_id)
    return await explorer_service.list_databases(client)


@router.get("/databases/{db_name}/collections")
async def collections(
    db_name: str, conn_id: str = Query(alias="connection"), user: CurrentUser = None
) -> list[dict]:
    client = await _read_only_client(conn_id)
    return await explorer_service.list_collections(client, db_name)


@router.get("/databases/{db_name}/collections/{coll_name}/documents")
async def documents(
    db_name: str,
    coll_name: str,
    conn_id: str = Query(alias="connection"),
    page: int = 1,
    page_size: int = 25,
    sort: str = "_id:-1",
    filter: str = "",
    user: CurrentUser = None,
) -> dict:
    client = await _read_only_client(conn_id)
    import json

    try:
        raw = json.loads(filter) if filter.strip() else {}
    except json.JSONDecodeError as exc:
        raise HTTPException(400, f"Invalid JSON filter: {exc}") from exc
    if not isinstance(raw, dict):
        raise HTTPException(400, "Filter must be a JSON object")
    mongo_filter = explorer_service.parse_filter(raw)
    return await explorer_service.find_documents(
        client, db_name, coll_name, mongo_filter,
        explorer_service.validate_sort(sort), page, page_size,
    )


@router.get("/databases/{db_name}/collections/{coll_name}/documents/{doc_id}")
async def document(
    db_name: str, coll_name: str, doc_id: str,
    conn_id: str = Query(alias="connection"), user: CurrentUser = None,
) -> dict:
    client = await _read_only_client(conn_id)
    doc = await explorer_service.get_document(client, db_name, coll_name, doc_id)
    if doc is None:
        raise HTTPException(404, "Document not found")
    return doc


@router.get("/databases/{db_name}/collections/{coll_name}/schema")
async def schema(
    db_name: str, coll_name: str,
    conn_id: str = Query(alias="connection"), user: CurrentUser = None,
) -> dict:
    client = await _read_only_client(conn_id)
    return await explorer_service.schema_sample(client, db_name, coll_name)
