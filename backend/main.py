import os
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

from . import auth, db


@asynccontextmanager
async def lifespan(app):
    if os.environ.get("DATABASE_URL"):
        db.init_db()
    yield


app = FastAPI(title="GraphMind", lifespan=lifespan)
app.include_router(auth.router)


@app.get("/api/health")
def health():
    url = os.environ.get("DATABASE_URL")
    if not url:
        return {"db": "not configured"}
    try:
        import psycopg

        with psycopg.connect(url, connect_timeout=5) as conn:
            conn.execute("SELECT 1")
        return {"db": "ok"}
    except Exception as e:
        return {"db": "error", "detail": str(e)}


dist = Path(__file__).resolve().parent.parent / "frontend" / "dist"
if dist.is_dir():
    app.mount("/", StaticFiles(directory=dist, html=True), name="app")
