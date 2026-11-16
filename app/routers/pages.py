"""Serves the frontend shell."""
from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse
from fastapi.templating import Jinja2Templates

router = APIRouter(include_in_schema=False)
def _find_templates_dir() -> Path:
    candidates = [
        Path(__file__).resolve().parent.parent / "templates",
        Path.cwd() / "app" / "templates",
        Path("/var/task/app/templates"),
    ]
    for c in candidates:
        if c.is_dir():
            return c
    return candidates[0]


templates = Jinja2Templates(directory=str(_find_templates_dir()))


@router.get("/", response_class=HTMLResponse)
async def index(request: Request) -> HTMLResponse:
    return templates.TemplateResponse(request=request, name="index.html")
