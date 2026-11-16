"""Job applications API: multipart create/patch, streaming PDF with Range support."""
from __future__ import annotations

import re
from datetime import date
from typing import Annotated
from urllib.parse import quote

from fastapi import (
    APIRouter,
    File,
    Form,
    Header,
    HTTPException,
    Request,
    Response,
    UploadFile,
)
from fastapi.responses import StreamingResponse

from app.db.mongo import get_app_db
from app.routers.deps import CurrentUser, WorkspaceDB, client_ip
from app.schemas.application import Status
from app.services import application_service as apps
from app.services.audit_service import audit

router = APIRouter(prefix="/api/applications", tags=["applications"])

_STATUS_VALUES = Status.__args__ if hasattr(Status, "__args__") else ()
_RANGE_RE = re.compile(r"^bytes=(\d*)-(\d*)$")


def _validate_status(value: str | None, default: str = "saved") -> str:
    if value is None or value == "":
        return default
    if value not in _STATUS_VALUES:
        raise HTTPException(422, f"Invalid status; allowed: {', '.join(_STATUS_VALUES)}")
    return value


def _parse_date(value: str | None) -> date | None:
    if not value:
        return None
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise HTTPException(422, "applied_on must be an ISO date (YYYY-MM-DD)") from exc


@router.post("", status_code=201)
async def create_application(
    user: CurrentUser,
    request: Request,
    db: WorkspaceDB,
    company: Annotated[str, Form(min_length=1, max_length=200)],
    job_title: Annotated[str, Form(min_length=1, max_length=200)],
    job_description: Annotated[str, Form(max_length=50000)],
    status: Annotated[str | None, Form()] = None,
    applied_on: Annotated[str | None, Form()] = None,
    job_url: Annotated[str | None, Form(max_length=2000)] = None,
    notes: Annotated[str | None, Form(max_length=10000)] = None,
    file: Annotated[UploadFile | None, File(description="Resume PDF")] = None,
    resume_id: Annotated[str | None, Form()] = None,
) -> dict:
    record = await apps.create_application(
        db,
        company=company,
        job_title=job_title,
        job_description=job_description,
        status=_validate_status(status),
        applied_on=_parse_date(applied_on),
        job_url=job_url,
        notes=notes,
        file=file,
        existing_resume_id=resume_id,
        user_id=user,
    )
    await audit(
        get_app_db(), "application.create", ip=client_ip(request),
        application_id=record["id"], gridfs_id=record["resume"]["gridfs_id"] if record["resume"] else None,
    )
    return record


@router.get("/resumes")
async def list_resumes(user: CurrentUser, db: WorkspaceDB) -> list[dict]:
    return await apps.list_resumes(db, user_id=user)


@router.get("/export")
async def export_applications_data(
    user: CurrentUser,
    db: WorkspaceDB,
    format: str = "json",
) -> Response:
    import csv
    import io
    import json

    data = await apps.export_applications(db, user_id=user)
    if format == "csv":
        output = io.StringIO()
        writer = csv.writer(output)
        writer.writerow([
            "Company", "Job Title", "Status", "Applied On",
            "Job URL", "Resume Filename", "Notes", "Job Description",
        ])
        for item in data:
            resume_name = item.get("resume", {}).get("filename", "") if item.get("resume") else ""
            writer.writerow([
                item.get("company", ""),
                item.get("job_title", ""),
                item.get("status", ""),
                str(item.get("applied_on") or ""),
                item.get("job_url", "") or "",
                resume_name,
                item.get("notes", "") or "",
                item.get("job_description", "") or "",
            ])
        csv_bytes = output.getvalue().encode("utf-8")
        return Response(
            content=csv_bytes,
            media_type="text/csv",
            headers={"Content-Disposition": 'attachment; filename="jobtracker_applications.csv"'},
        )
    json_bytes = json.dumps(data, indent=2, default=str).encode("utf-8")
    return Response(
        content=json_bytes,
        media_type="application/json",
        headers={"Content-Disposition": 'attachment; filename="jobtracker_applications.json"'},
    )


@router.get("")
async def list_applications(
    user: CurrentUser,
    db: WorkspaceDB,
    search: str = "",
    status_filter: str = "",
    sort: str = "created_desc",
) -> list[dict]:
    if status_filter and status_filter not in _STATUS_VALUES:
        raise HTTPException(422, "Invalid status filter")
    return await apps.list_applications(
        db, search=search, status=status_filter, sort=sort, user_id=user
    )


@router.get("/{app_id}")
async def get_application(user: CurrentUser, db: WorkspaceDB, app_id: str) -> dict:
    record = await apps.get_application(db, app_id, user_id=user)
    if record is None:
        raise HTTPException(404, "Application not found")
    return record


@router.patch("/{app_id}")
async def update_application(
    user: CurrentUser,
    request: Request,
    db: WorkspaceDB,
    app_id: str,
    company: Annotated[str | None, Form(max_length=200)] = None,
    job_title: Annotated[str | None, Form(max_length=200)] = None,
    job_description: Annotated[str | None, Form(max_length=50000)] = None,
    status: Annotated[str | None, Form()] = None,
    applied_on: Annotated[str | None, Form()] = None,
    job_url: Annotated[str | None, Form(max_length=2000)] = None,
    notes: Annotated[str | None, Form(max_length=10000)] = None,
    file: Annotated[UploadFile | None, File()] = None,
    resume_id: Annotated[str | None, Form()] = None,
) -> dict:
    fields: dict = {}
    for key, value in (
        ("company", company), ("job_title", job_title),
        ("job_description", job_description), ("status", status),
        ("applied_on", applied_on), ("job_url", job_url), ("notes", notes),
    ):
        if value is not None:
            fields[key] = _parse_date(value) if key == "applied_on" else value
    if "status" in fields:
        fields["status"] = _validate_status(fields["status"])
    record = await apps.update_application(
        db, app_id, fields=fields, file=file, existing_resume_id=resume_id, user_id=user
    )
    if record is None:
        raise HTTPException(404, "Application not found")
    await audit(get_app_db(), "application.update", ip=client_ip(request), application_id=app_id)
    return record


@router.delete("/{app_id}")
async def delete_application(
    user: CurrentUser, request: Request, db: WorkspaceDB, app_id: str
) -> dict:
    ok = await apps.delete_application(db, app_id, user_id=user)
    if not ok:
        raise HTTPException(404, "Application not found")
    await audit(get_app_db(), "application.delete", ip=client_ip(request), application_id=app_id)
    return {"ok": True}


def _disposition(filename: str, download: bool) -> str:
    kind = "attachment" if download else "inline"
    return f"{kind}; filename*=UTF-8''{quote(filename)}"


@router.get("/{app_id}/resume")
async def get_resume(
    user: CurrentUser,
    request: Request,
    db: WorkspaceDB,
    app_id: str,
    download: bool = False,
    range_header: Annotated[str | None, Header(alias="range")] = None,
) -> Response:
    record, stream = await apps.open_resume_stream(db, app_id, user_id=user)
    if record is None or stream is None:
        raise HTTPException(404, "Resume not found")
    resume = record["resume"]
    filename = resume["filename"]
    size = stream.length
    base_headers = {
        "Content-Type": "application/pdf",
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
        "Accept-Ranges": "bytes",
    }
    await audit(
        get_app_db(),
        "resume.download" if download else "resume.view",
        ip=client_ip(request),
        application_id=app_id,
        gridfs_id=resume["gridfs_id"],
    )
    if range_header:
        match = _RANGE_RE.match(range_header.strip())
        if match and (match.group(1) or match.group(2)):
            start = int(match.group(1)) if match.group(1) else 0
            end = int(match.group(2)) if match.group(2) else size - 1
            end = min(end, size - 1)
            if start > end or start >= size:
                return Response(
                    status_code=416,
                    headers={**base_headers, "Content-Range": f"bytes */{size}"},
                )
            length = end - start + 1
            return StreamingResponse(
                apps.iter_range(stream, start, length),
                status_code=206,
                headers={
                    **base_headers,
                    "Content-Range": f"bytes {start}-{end}/{size}",
                    "Content-Length": str(length),
                    "Content-Disposition": _disposition(filename, download),
                },
            )
    return StreamingResponse(
        apps.iter_range(stream, 0, size),
        headers={**base_headers, "Content-Disposition": _disposition(filename, download)},
    )
