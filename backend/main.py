from pathlib import Path
import sys
import traceback

backend_dir = Path(__file__).resolve().parent
if str(backend_dir) not in sys.path:
    sys.path.insert(0, str(backend_dir))

init_error = None
fastapi_app = None

try:
    from app.main import app as fastapi_app
except Exception:
    init_error = traceback.format_exc()


async def app(scope, receive, send):
    if init_error:
        body = f"STARTUP_ERROR:\n{init_error}".encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 500,
            "headers": [
                (b"content-type", b"text/plain; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({
            "type": "http.response.body",
            "body": body,
        })
        return

    try:
        await fastapi_app(scope, receive, send)
    except Exception:
        err = traceback.format_exc()
        body = f"RUNTIME_ERROR:\n{err}".encode("utf-8")
        await send({
            "type": "http.response.start",
            "status": 500,
            "headers": [
                (b"content-type", b"text/plain; charset=utf-8"),
                (b"content-length", str(len(body)).encode("ascii")),
            ],
        })
        await send({
            "type": "http.response.body",
            "body": body,
        })
