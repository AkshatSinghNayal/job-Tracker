"""Shared test fixtures: app instance with isolated settings + real local MongoDB."""
from __future__ import annotations

import os
import secrets
import uuid

import pytest
from cryptography.fernet import Fernet
from httpx import ASGITransport, AsyncClient

TEST_DB_NAME = f"jobtracker_test_{uuid.uuid4().hex[:8]}"

# Env must be set before importing app modules.
os.environ.update(
    {
        "APP_SECRET_KEY": secrets.token_urlsafe(48),
        "FERNET_KEY": Fernet.generate_key().decode(),
        "ADMIN_USERNAME": "admin",
        "ADMIN_PASSWORD": "test-password-123",
        "APP_DB_URI": "mongodb://localhost:27017",
        "APP_DB_NAME": TEST_DB_NAME,
        "ACCESS_TOKEN_EXPIRE_MINUTES": "15",
        "REFRESH_TOKEN_EXPIRE_DAYS": "7",
        "COOKIE_SECURE": "false",
        "MAX_UPLOAD_MB": "10",
    }
)


@pytest.fixture(autouse=True)
def reset_rate_limiter():
    from app.services.rate_limit import rate_limiter

    rate_limiter._attempts.clear()
    rate_limiter._locked_until.clear()
    yield
    rate_limiter._attempts.clear()
    rate_limiter._locked_until.clear()


@pytest.fixture
async def app():
    from app.core.config import get_settings

    get_settings.cache_clear()
    from app.db import mongo
    from app.main import app as fastapi_app

    try:
        await mongo.connect_app_db()
    except Exception as exc:
        pytest.skip(f"MongoDB not reachable at localhost:27017: {exc}")

    async with fastapi_app.router.lifespan_context(fastapi_app):
        yield fastapi_app

    await mongo.close_app_db()
    await mongo.client_cache.close_all()


@pytest.fixture
async def client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        yield c


@pytest.fixture
async def admin_client(app):
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as c:
        res = await c.post(
            "/api/auth/login", json={"username": "admin", "password": "test-password-123"}
        )
        assert res.status_code == 200, res.text
        token = res.json()["access_token"]
        c.headers.update({"Authorization": f"Bearer {token}"})
        yield c


@pytest.fixture
def auth_headers(admin_client):
    return {"Authorization": admin_client.headers["Authorization"]}


@pytest.fixture
def sample_pdf() -> bytes:
    # Minimal but valid one-page PDF (correct magic bytes + xref).
    return (
        b"%PDF-1.4\n"
        b"1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n"
        b"2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n"
        b"3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 144]>>endobj\n"
        b"trailer<</Root 1 0 R>>\n%%EOF"
    )


@pytest.fixture(scope="session", autouse=True)
def cleanup_test_db():
    yield
    from motor.motor_asyncio import AsyncIOMotorClient

    AsyncIOMotorClient("mongodb://localhost:27017").drop_database(TEST_DB_NAME)
