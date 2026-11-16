#!/usr/bin/env python3
"""Seed 3 sample applications (with generated PDFs) into the configured app database."""
from __future__ import annotations

import asyncio
import hashlib
import sys
from datetime import UTC, date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from motor.motor_asyncio import AsyncIOMotorGridFSBucket  # noqa: E402
from pydantic_settings import BaseSettings, SettingsConfigDict  # noqa: E402


class SeedSettings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")
    app_db_uri: str = "mongodb://localhost:27017"
    app_db_name: str = "jobtracker"


def make_pdf(title: str) -> bytes:
    text = title.replace("(", "").replace(")", "")
    stream = f"BT /F1 16 Tf 20 100 Td ({text}) Tj ET".encode()
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]/Contents 4 0 R/Resources<</Font<</F1 5 0 R>>>>>>endobj\n"
        b"4 0 obj<</Length " + str(len(stream)).encode() + b">>stream\n" + stream + b"\nendstream endobj\n"
        b"5 0 obj<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF"
    )


SAMPLES = [
    {
        "company": "Northwind Labs",
        "job_title": "Senior Backend Engineer",
        "job_description": (
            "We are building a real-time data platform used by thousands of teams.\n\n"
            "You will: design Python services, own MongoDB data models, and mentor juniors.\n\n"
            "Requirements: 5+ years Python, async experience, strong SQL/NoSQL fundamentals."
        ),
        "status": "interviewing",
        "applied_on": date(2026, 10, 12),
        "job_url": "https://example.com/northwind/senior-backend",
        "notes": "Recruiter call went well. Technical round scheduled.",
    },
    {
        "company": "Vertex Robotics",
        "job_title": "Full-Stack Engineer",
        "job_description": (
            "Join the fleet tooling team.\n\n"
            "Stack: FastAPI, React, PostgreSQL, gRPC.\n"
            "Nice to have: robotics background, Kubernetes."
        ),
        "status": "applied",
        "applied_on": date(2026, 11, 2),
        "job_url": None,
        "notes": None,
    },
    {
        "company": "Cobalt Analytics",
        "job_title": "Platform Engineer",
        "job_description": (
            "Own the ingestion pipeline: 2B events/day, Kafka, ClickHouse.\n"
            "You will lead reliability work and on-call modernisation."
        ),
        "status": "saved",
        "applied_on": None,
        "job_url": "https://example.com/cobalt/platform-engineer",
        "notes": "Need to tailor resume for the data-platform angle.",
    },
]


async def main() -> None:
    settings = SeedSettings()
    from motor.motor_asyncio import AsyncIOMotorClient

    client = AsyncIOMotorClient(settings.app_db_uri, serverSelectionTimeoutMS=5000)
    db = client[settings.app_db_name]
    bucket = AsyncIOMotorGridFSBucket(db)

    existing = await db.applications.count_documents({})
    if existing:
        print(f"Database already has {existing} applications; seeding anyway.")

    for sample in SAMPLES:
        pdf = make_pdf(f"Resume - {sample['company']}")
        sha = hashlib.sha256(pdf).hexdigest()
        stream = bucket.open_upload_stream(f"resume-{sample['company'].lower().replace(' ', '-')}.pdf")
        await stream.write(pdf)
        await stream.close()
        now = datetime.now(UTC)
        doc = dict(sample)
        if isinstance(doc.get("applied_on"), date) and not isinstance(doc.get("applied_on"), datetime):
            d = doc["applied_on"]
            doc["applied_on"] = datetime(d.year, d.month, d.day, tzinfo=UTC)
        await db.applications.insert_one({
            "_id": hashlib.sha256(sample["company"].encode()).hexdigest()[:24],
            **doc,
            "resume": {
                "gridfs_id": str(stream._id),
                "filename": f"resume-{sample['company'].lower().replace(' ', '-')}.pdf",
                "size": len(pdf),
                "sha256": sha,
                "content_type": "application/pdf",
            },
            "created_at": now,
            "updated_at": now,
        })
        print(f"  seeded: {sample['company']} — {sample['job_title']}")
    client.close()
    print("Done.")


if __name__ == "__main__":
    asyncio.run(main())
