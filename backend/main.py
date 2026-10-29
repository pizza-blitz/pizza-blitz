from pathlib import Path
import sys

backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

from app.main import app  # noqa: E402,F401 - Vercel entrypoint re-exports the ASGI app
