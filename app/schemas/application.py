from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field

Status = Literal[
    "saved", "applied", "interviewing", "offer", "rejected", "withdrawn"
]

MAX_JD_CHARS = 50_000


class ResumeMeta(BaseModel):
    gridfs_id: str
    filename: str
    size: int
    sha256: str
    content_type: str = "application/pdf"


class ApplicationOut(BaseModel):
    id: str
    company: str
    job_title: str
    job_description: str
    status: Status
    applied_on: date | None
    job_url: str | None
    notes: str | None
    resume: ResumeMeta | None
    created_at: datetime
    updated_at: datetime


class ApplicationListItem(BaseModel):
    id: str
    company: str
    job_title: str
    status: Status
    applied_on: date | None
    has_resume: bool


class ApplicationUpdate(BaseModel):
    company: str | None = Field(default=None, min_length=1, max_length=200)
    job_title: str | None = Field(default=None, min_length=1, max_length=200)
    job_description: str | None = Field(default=None, max_length=MAX_JD_CHARS)
    status: Status | None = None
    applied_on: date | None = None
    job_url: str | None = Field(default=None, max_length=2000)
    notes: str | None = Field(default=None, max_length=10_000)
