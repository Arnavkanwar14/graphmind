import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

_env = Path(__file__).resolve().parent.parent / ".env"
if _env.is_file():
    for _line in _env.read_text().splitlines():
        if "=" in _line and not _line.startswith("#"):
            k, _, v = _line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())

from . import auth, chat, db, documents, graph


@asynccontextmanager
async def lifespan(app):
    if os.environ.get("DATABASE_URL"):
        db.init_db()
    yield


app = FastAPI(title="GraphMind", lifespan=lifespan)
app.include_router(auth.router)
app.include_router(documents.router)
app.include_router(graph.router)
app.include_router(chat.router)


@app.get("/api/health")
def health():
    url = os.environ.get("DATABASE_URL")
    if not url:
        return {"db": "not configured"}
    try:
        with db.connect() as conn:
            conn.execute("SELECT 1")
        return {"db": "ok"}
    except Exception:
        return {"db": "error"}


dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="app")
