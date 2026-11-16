"""Application + resume upload tests: valid upload, fake PDF, oversized, auth, cleanup."""
from __future__ import annotations

import pytest


def multipart_fields(company="Acme", title="Backend Engineer", jd="Build things."):
    return {
        "company": (None, company),
        "job_title": (None, title),
        "job_description": (None, jd),
        "status": (None, "applied"),
        "applied_on": (None, "2026-11-01"),
    }


async def upload(client, pdf: bytes, filename="resume.pdf", extra=None):
    files = dict(multipart_fields(**(extra or {})))
    files["file"] = (filename, pdf, "application/pdf")
    return await client.post("/api/applications", files=files)


async def test_valid_upload_and_fetch(admin_client, sample_pdf):
    res = await upload(admin_client, sample_pdf)
    assert res.status_code == 201, res.text
    record = res.json()
    assert record["company"] == "Acme"
    assert record["resume"]["size"] == len(sample_pdf)
    assert len(record["resume"]["sha256"]) == 64

    got = await admin_client.get(f"/api/applications/{record['id']}")
    assert got.status_code == 200
    assert got.json()["job_description"] == "Build things."

    listed = await admin_client.get("/api/applications")
    items = listed.json()
    assert any(i["id"] == record["id"] for i in items)
    assert "job_description" not in items[0]  # list payload stays lean


async def test_renamed_non_pdf_rejected(admin_client):
    fake = b"This is definitely not a PDF, just text renamed to .pdf"
    res = await upload(admin_client, fake, filename="resume.pdf")
    assert res.status_code == 400
    assert "not a PDF" in res.json()["detail"]


async def test_empty_file_rejected(admin_client):
    res = await upload(admin_client, b"")
    assert res.status_code == 400


async def test_oversized_rejected(admin_client, monkeypatch):
    from app.core.config import get_settings

    settings = get_settings()
    monkeypatch.setattr(settings, "max_upload_mb", 1, raising=False)
    monkeypatch.setattr(
        type(settings), "max_upload_bytes",
        property(lambda self: self.max_upload_mb * 1024 * 1024),
    )
    big = b"%PDF-1.4" + b"\x00" * (2 * 1024 * 1024)
    res = await upload(admin_client, big)
    assert res.status_code == 413


async def test_resume_requires_bearer(client, admin_client, sample_pdf):
    res = await upload(admin_client, sample_pdf)
    app_id = res.json()["id"]
    unauth = await client.get(f"/api/applications/{app_id}/resume")
    assert unauth.status_code == 401


async def test_resume_headers_and_range(admin_client, sample_pdf):
    res = await upload(admin_client, sample_pdf)
    app_id = res.json()["id"]
    got = await admin_client.get(f"/api/applications/{app_id}/resume")
    assert got.status_code == 200
    assert got.headers["content-type"] == "application/pdf"
    assert got.headers["x-content-type-options"] == "nosniff"
    assert got.headers["cache-control"] == "private, no-store"
    assert "inline" in got.headers["content-disposition"]

    rng = await admin_client.get(
        f"/api/applications/{app_id}/resume", headers={"Range": "bytes=0-99"}
    )
    assert rng.status_code == 206
    assert rng.headers["content-range"] == f"bytes 0-99/{len(sample_pdf)}"

    dl = await admin_client.get(f"/api/applications/{app_id}/resume?download=1")
    assert "attachment" in dl.headers["content-disposition"]


async def test_delete_cleans_gridfs(admin_client, sample_pdf):
    from bson import ObjectId
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket

    from app.db.mongo import get_app_db

    res = await upload(admin_client, sample_pdf)
    record = res.json()
    gfs_id = record["resume"]["gridfs_id"]

    deleted = await admin_client.delete(f"/api/applications/{record['id']}")
    assert deleted.status_code == 200

    bucket = AsyncIOMotorGridFSBucket(get_app_db())
    with pytest.raises(Exception):
        await bucket.open_download_stream(ObjectId(gfs_id))
    gone = await admin_client.get(f"/api/applications/{record['id']}")
    assert gone.status_code == 404


async def test_replace_resume_removes_old_file(admin_client, sample_pdf):
    res = await upload(admin_client, sample_pdf)
    record = res.json()
    old_gfs = record["resume"]["gridfs_id"]

    new_pdf = sample_pdf.replace(b"Acme", b"")  # different bytes, same validity
    files = {
        "company": (None, record["company"]),
        "job_title": (None, record["job_title"]),
        "job_description": (None, "updated JD"),
        "file": ("new-resume.pdf", new_pdf, "application/pdf"),
    }
    patched = await admin_client.patch(f"/api/applications/{record['id']}", files=files)
    assert patched.status_code == 200, patched.text
    new_record = patched.json()
    assert new_record["resume"]["filename"] == "new-resume.pdf"
    assert new_record["resume"]["gridfs_id"] != old_gfs
    assert new_record["job_description"] == "updated JD"

    from bson import ObjectId
    from motor.motor_asyncio import AsyncIOMotorGridFSBucket

    from app.db.mongo import get_app_db

    bucket = AsyncIOMotorGridFSBucket(get_app_db())
    with pytest.raises(Exception):
        await bucket.open_download_stream(ObjectId(old_gfs))


async def test_search_and_status_filter(admin_client, sample_pdf):
    await upload(admin_client, sample_pdf, extra={"company": "ZetaCorp"})
    await upload(admin_client, sample_pdf, extra={"company": "AlphaLabs"})
    searched = await admin_client.get("/api/applications?search=alpha")
    assert [i["company"] for i in searched.json()] == ["AlphaLabs"]
    filtered = await admin_client.get("/api/applications?status_filter=saved")
    assert filtered.json() == []


async def test_resumes_list_and_reuse(admin_client, sample_pdf):
    res = await upload(admin_client, sample_pdf, extra={"company": "Original Corp"})
    record = res.json()
    gfs_id = record["resume"]["gridfs_id"]

    resumes_res = await admin_client.get("/api/applications/resumes")
    assert resumes_res.status_code == 200
    resumes = resumes_res.json()
    assert any(r["gridfs_id"] == gfs_id for r in resumes)

    # Create another application reusing the existing resume
    form = {
        "company": (None, "Reused Corp"),
        "job_title": (None, "Frontend Dev"),
        "job_description": (None, "React work"),
        "status": (None, "saved"),
        "resume_id": (None, gfs_id),
    }
    reused = await admin_client.post("/api/applications", files=form)
    assert reused.status_code == 201, reused.text
    reused_record = reused.json()
    assert reused_record["resume"]["gridfs_id"] == gfs_id
    assert reused_record["company"] == "Reused Corp"


async def test_export_endpoints(admin_client, sample_pdf):
    await upload(admin_client, sample_pdf, extra={"company": "Export Corp"})
    json_export = await admin_client.get("/api/applications/export?format=json")
    assert json_export.status_code == 200
    assert "attachment" in json_export.headers.get("content-disposition", "")
    assert isinstance(json_export.json(), list)

    csv_export = await admin_client.get("/api/applications/export?format=csv")
    assert csv_export.status_code == 200
    assert "text/csv" in csv_export.headers.get("content-type", "")
    assert "Company,Job Title" in csv_export.text


async def test_multi_user_isolation(client, sample_pdf):
    # 1. Register User Bob
    res_bob = await client.post(
        "/api/auth/register", json={"username": "bob", "password": "password123"}
    )
    token_bob = res_bob.json()["access_token"]
    client.headers.update({"Authorization": f"Bearer {token_bob}"})

    # Bob uploads an application with a resume
    bob_app = await upload(client, sample_pdf, filename="bob_resume.pdf", extra={"company": "Bob Inc"})
    assert bob_app.status_code == 201
    bob_app_id = bob_app.json()["id"]

    # 2. Register User Charlie
    res_charlie = await client.post(
        "/api/auth/register", json={"username": "charlie", "password": "password456"}
    )
    token_charlie = res_charlie.json()["access_token"]
    client.headers.update({"Authorization": f"Bearer {token_charlie}"})

    # Charlie checks applications -> must be empty (cannot see Bob's app)
    charlie_apps = await client.get("/api/applications")
    assert charlie_apps.status_code == 200
    assert len(charlie_apps.json()) == 0

    # Charlie checks resumes list -> must be empty (cannot see Bob's resume)
    charlie_resumes = await client.get("/api/applications/resumes")
    assert charlie_resumes.status_code == 200
    assert len(charlie_resumes.json()) == 0

    # Charlie tries to directly access Bob's application -> 404
    direct_get = await client.get(f"/api/applications/{bob_app_id}")
    assert direct_get.status_code == 404

    # Charlie tries to stream Bob's resume -> 404
    direct_resume = await client.get(f"/api/applications/{bob_app_id}/resume")
    assert direct_resume.status_code == 404

    # Charlie tries to delete Bob's application -> 404
    direct_del = await client.delete(f"/api/applications/{bob_app_id}")
    assert direct_del.status_code == 404

    # Charlie tries to reuse Bob's resume -> 404
    bob_gfs_id = bob_app.json()["resume"]["gridfs_id"]
    stolen_create = await client.post("/api/applications", files={
        "company": (None, "Charlie Corp"),
        "job_title": (None, "Dev"),
        "job_description": (None, "Testing"),
        "resume_id": (None, bob_gfs_id),
    })
    assert stolen_create.status_code == 404
