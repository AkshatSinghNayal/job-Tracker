# Vercel entrypoint — the Python runtime serves this ASGI app directly.
import sys
from pathlib import Path

# Add workspace root to sys.path so 'app' is always cleanly imported on Vercel
root_dir = Path(__file__).resolve().parent.parent
if str(root_dir) not in sys.path:
    sys.path.insert(0, str(root_dir))

from app.main import app  # noqa: F401, E402

# Export both 'app' and 'handler' for full compatibility across all Vercel Python runtimes
handler = app


