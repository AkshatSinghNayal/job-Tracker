"""FastAPI application entrypoint: lifespan, middleware, error handling, routes."""
from __future__ import annotations

import asyncio
import os
import uuid
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.encoders import jsonable_encoder
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from app.core.config import get_settings
from app.core.logging import configure_logging, get_logger
from app.db.mongo import client_cache, close_app_db, connect_app_db, get_app_db
from app.routers import applications, auth, connections, explorer, pages
from app.services import auth_service

log = get_logger(__name__)

CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data: blob:; "
    "font-src 'self' data:; "
    "connect-src 'self'; "
    "frame-src 'self' blob:; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'self'"
)


_started = False
_start_lock = asyncio.Lock()


async def ensure_started() -> None:
    """Idempotent startup: works under lifespan (Docker/local) and per-request
    (Vercel serverless, which does not run lifespan events)."""
    global _started
    if _started:
        return
    async with _start_lock:
        if _started:
            return
        settings = get_settings()
        configure_logging()
        log.info(
            "starting jobtracker",
            extra={"ctx": {"db_name": settings.app_db_name, "cookie_secure": settings.cookie_secure}},
        )
        try:
            db = await connect_app_db()  # fails fast if APP_DB_URI is unreachable
            await auth_service.ensure_admin(db)
            await db["applications"].create_index([("company", 1), ("created_at", -1)])
            await db["applications"].create_index("status")
            await db["connections"].create_index("name")
            await db["refresh_tokens"].create_index("expires_at", expireAfterSeconds=0)
            _started = True
        except Exception as exc:
            log.exception("Startup DB connection error: %s", exc)
            if not os.environ.get("VERCEL"):
                raise


@asynccontextmanager
async def lifespan(app: FastAPI):
    await ensure_started()
    yield
    await client_cache.close_all()
    await close_app_db()
    log.info("shutdown complete")


def create_app() -> FastAPI:
    settings = get_settings()
    app = FastAPI(
        title=settings.app_name,
        lifespan=lifespan,
        docs_url=None,  # single-owner private app: no public API docs surface
        redoc_url=None,
        openapi_url=None,
    )

    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.origins,
        allow_credentials=True,
        allow_methods=["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
        allow_headers=["Authorization", "Content-Type", "X-Connection-Id"],
    )

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        try:
            await ensure_started()  # no-op after first call; required on serverless
        except Exception as exc:
            log.error("ensure_started error in middleware: %s", exc)
        response = await call_next(request)
        response.headers["Content-Security-Policy"] = CSP
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "SAMEORIGIN"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Permissions-Policy"] = "camera=(), microphone=(), geolocation=()"
        return response

    @app.middleware("http")
    async def request_size_cap(request: Request, call_next):
        max_bytes = settings.max_upload_bytes + 1024 * 1024  # multipart overhead
        length = request.headers.get("content-length")
        if length and length.isdigit() and int(length) > max_bytes:
            return JSONResponse(
                status_code=413,
                content={"detail": f"Request exceeds the {settings.max_upload_mb} MB limit"},
            )
        return await call_next(request)

    @app.exception_handler(HTTPException)
    async def http_exception_handler(request: Request, exc: HTTPException):
        return JSONResponse(status_code=exc.status_code, content={"detail": exc.detail})

    @app.exception_handler(RequestValidationError)
    async def validation_handler(request: Request, exc: RequestValidationError):
        return JSONResponse(status_code=422, content={"detail": jsonable_encoder(exc.errors()[:10])})

    @app.exception_handler(Exception)
    async def unhandled_handler(request: Request, exc: Exception):
        request_id = uuid.uuid4().hex[:12]
        log.error(
            "unhandled error",
            extra={"ctx": {"request_id": request_id, "path": request.url.path}},
        )
        return JSONResponse(
            status_code=500,
            content={"detail": "Internal server error", "request_id": request_id},
        )

    @app.get("/health", tags=["health"])
    async def health() -> dict:
        try:
            await get_app_db().command("ping")
            db_ok = True
        except Exception:  # noqa: BLE001
            db_ok = False
        return {"status": "ok" if db_ok else "degraded", "db": db_ok}

    app.include_router(auth.router)
    app.include_router(connections.router)
    app.include_router(applications.router)
    app.include_router(explorer.router)
    app.include_router(pages.router)

    static_candidates = [
        Path(__file__).resolve().parent / "static",
        Path.cwd() / "app" / "static",
        Path("/var/task/app/static"),
    ]
    static_dir = next((c for c in static_candidates if c.is_dir()), static_candidates[0])
    app.mount("/static", StaticFiles(directory=str(static_dir), check_dir=False), name="static")
    return app


app = create_app()
