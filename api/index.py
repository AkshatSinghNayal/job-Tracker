# Vercel entrypoint — the Python runtime serves this ASGI app directly.
# Startup (DB connect, admin bootstrap, indexes) runs lazily on the first
# request via app.main.ensure_started(); see app/main.py.
from app.main import app  # noqa: F401  (ASGI callable consumed by Vercel)
