"""Job applications + resume PDFs in GridFS. All IO is streamed and async."""
from __future__ import annotations

import hashlib
import re
import uuid
from collections.abc import AsyncIterator
from datetime import UTC, date, datetime
from typing import Any

from bson import ObjectId
from fastapi import HTTPException, UploadFile
from motor.motor_asyncio import AsyncIOMotorDatabase, AsyncIOMotorGridFSBucket
from pymongo.errors import PyMongoError

from app.core.config import get_settings
from app.core.logging import get_logger
from app.schemas.application import MAX_JD_CHARS, ResumeMeta

log = get_logger(__name__)
COLLECTION = "applications"
CHUNK = 64 * 1024
PDF_MAGIC = b"%PDF-"
_FILENAME_BAD = re.compile(r"[^\w.\- ]+")
SORTS: dict[str, list[tuple[str, int]]] = {
    "created_desc": [("created_at", -1)],
    "created_asc": [("created_at", 1)],
    "company_asc": [("company", 1)],
    "applied_desc": [("applied_on", -1)],
    "applied_asc": [("applied_on", 1)],
    "updated_desc": [("updated_at", -1)],
}


def sanitize_filename(name: str) -> str:
    base = name.replace("\\", "/").rsplit("/", 1)[-1]  # never trust client paths
    base = _FILENAME_BAD.sub("_", base).strip(" .") or "resume.pdf"
    return base[:180]


def _now() -> datetime:
    return datetime.now(UTC)


def _to_dt(val: Any) -> Any:
    if isinstance(val, date) and not isinstance(val, datetime):
        return datetime(val.year, val.month, val.day, tzinfo=UTC)
    return val


def _user_scope(user_id: str) -> dict[str, Any]:
    from app.core.config import get_settings

    admin = get_settings().admin_username
    if user_id == admin:
        return {"$or": [{"user_id": user_id}, {"user_id": {"$exists": False}}]}
    return {"user_id": user_id}


async def stream_upload_pdf(
    bucket: AsyncIOMotorGridFSBucket, file: UploadFile
) -> ResumeMeta:
    """Stream the upload into GridFS: magic-byte check, size cap, sha256, no orphans."""
    settings = get_settings()
    max_bytes = settings.max_upload_bytes
    filename = sanitize_filename(file.filename or "resume.pdf")
    sha = hashlib.sha256()
    total = 0
    first = True
    stream = bucket.open_upload_stream(filename)
    try:
        while True:
            chunk = await file.read(CHUNK)
            if not chunk:
                break
            if first:
                if not chunk.startswith(PDF_MAGIC):
                    raise HTTPException(400, "File is not a PDF (invalid magic bytes)")
                first = False
            total += len(chunk)
            if total > max_bytes:
                raise HTTPException(
                    413, f"File exceeds the {settings.max_upload_mb} MB limit"
                )
            sha.update(chunk)
            await stream.write(chunk)
        if total == 0:
            raise HTTPException(400, "Uploaded file is empty")
        await stream.close()  # flushes chunks; _id becomes durable
        meta = ResumeMeta(
            gridfs_id=str(stream._id),
            filename=filename,
            size=total,
            sha256=sha.hexdigest(),
            content_type="application/pdf",
        )
        return meta
    except HTTPException:
        try:
            await stream.close()
        except Exception:  # noqa: BLE001
            pass
        await safe_delete_file(bucket, stream._id)
        raise
    except PyMongoError as exc:
        await safe_delete_file(bucket, stream._id)
        log.error("gridfs upload failed", extra={"ctx": {"error": type(exc).__name__}})
        raise HTTPException(503, "Storage failure while saving resume") from exc


async def safe_delete_file(bucket: AsyncIOMotorGridFSBucket, file_id: Any) -> None:
    try:
        oid = (
            ObjectId(file_id)
            if isinstance(file_id, str) and ObjectId.is_valid(file_id)
            else file_id
        )
        await bucket.delete(oid)
    except Exception:  # already gone: idempotent cleanup
        pass


def public(doc: dict) -> dict:
    applied_on = doc.get("applied_on")
    if isinstance(applied_on, datetime):
        applied_on = applied_on.date()
    return {
        "id": str(doc["_id"]),
        "company": doc["company"],
        "job_title": doc["job_title"],
        "job_description": doc.get("job_description", ""),
        "status": doc.get("status", "saved"),
        "applied_on": applied_on,
        "job_url": doc.get("job_url"),
        "notes": doc.get("notes"),
        "resume": doc.get("resume"),
        "created_at": doc.get("created_at"),
        "updated_at": doc.get("updated_at"),
    }


async def create_application(
    db: AsyncIOMotorDatabase,
    *,
    company: str,
    job_title: str,
    job_description: str,
    status: str,
    applied_on: date | None,
    job_url: str | None,
    notes: str | None,
    file: UploadFile | None = None,
    existing_resume_id: str | None = None,
    user_id: str = "admin",
) -> dict:
    if len(job_description) > MAX_JD_CHARS:
        raise HTTPException(422, f"Job description exceeds {MAX_JD_CHARS} characters")
    bucket = AsyncIOMotorGridFSBucket(db)

    meta = None
    if file is not None and file.filename:
        meta = await stream_upload_pdf(bucket, file)  # upload first; insert after
    elif existing_resume_id:
        doc = await db[COLLECTION].find_one({"resume.gridfs_id": existing_resume_id, **_user_scope(user_id)})
        if not doc or not doc.get("resume"):
            raise HTTPException(404, "Referenced resume not found")
        meta = ResumeMeta(**doc["resume"])
    else:
        raise HTTPException(422, "Resume PDF file or existing resume selection is required")

    app_id = uuid.uuid4().hex
    now = _now()
    record = {
        "_id": app_id,
        "user_id": user_id,
        "company": company.strip(),
        "job_title": job_title.strip(),
        "job_description": job_description,
        "status": status,
        "applied_on": _to_dt(applied_on),
        "job_url": (job_url or None) and job_url.strip() or None,
        "notes": notes,
        "resume": meta.model_dump() if meta else None,
        "created_at": now,
        "updated_at": now,
    }
    try:
        await db[COLLECTION].insert_one(record)
    except PyMongoError as exc:
        if file is not None and meta:
            await safe_delete_file(bucket, meta.gridfs_id)  # no orphans
        raise HTTPException(503, "Database failure while saving application") from exc
    log.info("application created", extra={"ctx": {"application_id": app_id}})
    return public(record)


async def list_applications(
    db: AsyncIOMotorDatabase,
    *,
    search: str = "",
    status: str = "",
    sort: str = "created_desc",
    user_id: str = "admin",
) -> list[dict]:
    user_q = _user_scope(user_id)
    conditions: list[dict[str, Any]] = [user_q]
    if search.strip():
        needle = re.escape(search.strip())
        regex = {"$regex": needle, "$options": "i"}
        conditions.append({
            "$or": [
                {"company": regex},
                {"job_title": regex},
                {"job_description": regex},
            ]
        })
    if status:
        conditions.append({"status": status})
    query = {"$and": conditions} if len(conditions) > 1 else conditions[0]
    cursor = (
        db[COLLECTION]
        .find(query, {"job_description": 0})
        .sort(SORTS.get(sort, SORTS["created_desc"]))
        .limit(1000)
    )
    out = []
    async for doc in cursor:
        app_date = doc.get("applied_on")
        if isinstance(app_date, datetime):
            app_date = app_date.date()
        out.append(
            {
                "id": str(doc["_id"]),
                "company": doc["company"],
                "job_title": doc["job_title"],
                "status": doc.get("status", "saved"),
                "applied_on": app_date,
                "has_resume": bool(doc.get("resume")),
            }
        )
    return out


async def get_application(db: AsyncIOMotorDatabase, app_id: str, user_id: str = "admin") -> dict | None:
    doc = await db[COLLECTION].find_one({"_id": app_id, **_user_scope(user_id)})
    return public(doc) if doc else None


async def update_application(
    db: AsyncIOMotorDatabase,
    app_id: str,
    *,
    fields: dict[str, Any],
    file: UploadFile | None,
    existing_resume_id: str | None = None,
    user_id: str = "admin",
) -> dict | None:
    user_q = _user_scope(user_id)
    existing = await db[COLLECTION].find_one({"_id": app_id, **user_q})
    if not existing:
        return None
    bucket = AsyncIOMotorGridFSBucket(db)
    old_resume = existing.get("resume")
    update: dict[str, Any] = {"updated_at": _now()}
    for key in ("company", "job_title", "job_description", "status", "applied_on", "job_url", "notes"):
        if key in fields and fields[key] is not None:
            value = fields[key]
            if key in ("company", "job_title"):
                value = str(value).strip()
            elif key == "applied_on":
                value = _to_dt(value)
            update[key] = value
    jd = fields.get("job_description")
    if jd and len(jd) > MAX_JD_CHARS:
        raise HTTPException(422, f"Job description exceeds {MAX_JD_CHARS} characters")

    new_meta = None
    if file is not None and file.filename is not None:
        new_meta = await stream_upload_pdf(bucket, file)
        update["resume"] = new_meta.model_dump()
    elif existing_resume_id:
        doc = await db[COLLECTION].find_one({"resume.gridfs_id": existing_resume_id, **user_q})
        if doc and doc.get("resume"):
            new_meta = ResumeMeta(**doc["resume"])
            update["resume"] = new_meta.model_dump()

    await db[COLLECTION].update_one({"_id": app_id, **user_q}, {"$set": update})
    # replace succeeded with a fresh upload → remove the old file only now
    if (
        new_meta is not None
        and file is not None
        and old_resume
        and old_resume.get("gridfs_id") != new_meta.gridfs_id
    ):
        await safe_delete_file(bucket, old_resume.get("gridfs_id"))
    log.info(
        "application updated",
        extra={"ctx": {"application_id": app_id, "resume_replaced": new_meta is not None}},
    )
    updated = await db[COLLECTION].find_one({"_id": app_id, **user_q})
    return public(updated) if updated else None


async def list_resumes(db: AsyncIOMotorDatabase, user_id: str = "admin") -> list[dict]:
    cursor = db[COLLECTION].find(
        {"resume": {"$ne": None}, **_user_scope(user_id)},
        {"resume": 1, "company": 1, "created_at": 1},
    ).sort("created_at", -1)
    seen = set()
    resumes = []
    async for doc in cursor:
        r = doc.get("resume")
        if r and r.get("gridfs_id") and r["gridfs_id"] not in seen:
            seen.add(r["gridfs_id"])
            resumes.append(
                {
                    "gridfs_id": r["gridfs_id"],
                    "filename": r.get("filename", "resume.pdf"),
                    "size": r.get("size", 0),
                    "sha256": r.get("sha256", ""),
                    "company": doc.get("company", ""),
                }
            )
    return resumes


async def export_applications(db: AsyncIOMotorDatabase, user_id: str = "admin") -> list[dict]:
    cursor = db[COLLECTION].find(_user_scope(user_id)).sort("created_at", -1)
    items = []
    async for doc in cursor:
        items.append(public(doc))
    return items


async def delete_application(db: AsyncIOMotorDatabase, app_id: str, user_id: str = "admin") -> bool:
    user_q = _user_scope(user_id)
    doc = await db[COLLECTION].find_one({"_id": app_id, **user_q}, {"resume": 1})
    if not doc:
        return False
    resume = doc.get("resume")
    result = await db[COLLECTION].delete_one({"_id": app_id, **user_q})
    if result.deleted_count and resume:
        await safe_delete_file(AsyncIOMotorGridFSBucket(db), resume.get("gridfs_id"))
    log.info("application deleted", extra={"ctx": {"application_id": app_id}})
    return result.deleted_count > 0


async def open_resume_stream(db: AsyncIOMotorDatabase, app_id: str, user_id: str = "admin"):
    """Return (record, gridfs_download_stream) or (None, None)."""
    doc = await db[COLLECTION].find_one({"_id": app_id, **_user_scope(user_id)})
    if not doc or not doc.get("resume"):
        return None, None
    bucket = AsyncIOMotorGridFSBucket(db)
    from bson import ObjectId

    stream = await bucket.open_download_stream(ObjectId(doc["resume"]["gridfs_id"]))
    return public(doc), stream


async def iter_range(stream, start: int, length: int) -> AsyncIterator[bytes]:
    stream.seek(start)
    remaining = length
    while remaining > 0:
        chunk = await stream.read(min(CHUNK, remaining))
        if not chunk:
            break
        remaining -= len(chunk)
        yield chunk
