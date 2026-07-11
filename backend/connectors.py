"""Customer-owned data sources: AWS S3 (their keys) and Google Drive (OAuth).

Credentials are envelope-encrypted with the user's key, exactly like documents.
Sync pulls supported files through the same ingest pipeline as direct upload.
"""

import json
import os
import secrets
import time
import urllib.parse
import urllib.request

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from . import db
from .auth import current_user
from .documents import ALLOWED, MAX_SIZE, ingest_bytes, process_document, user_fernet

router = APIRouter(prefix="/api/connectors")

# ponytail: in-memory OAuth state store; single instance, 10-min expiry
_oauth_states: dict = {}


def _save_config(user: dict, kind: str, label: str, config: dict) -> int:
    blob = user_fernet(user["enc_key"]).encrypt(json.dumps(config).encode())
    with db.connect() as conn:
        row = conn.execute(
            "INSERT INTO connectors (user_id, kind, label, config_encrypted)"
            " VALUES (%s, %s, %s, %s)"
            " ON CONFLICT (user_id, kind, label) DO UPDATE SET config_encrypted = EXCLUDED.config_encrypted"
            " RETURNING id",
            (user["id"], kind, label, blob),
        ).fetchone()
    return row[0]


def _load_config(user: dict, connector_id: int):
    with db.connect() as conn:
        row = conn.execute(
            "SELECT kind, label, config_encrypted FROM connectors WHERE id = %s AND user_id = %s",
            (connector_id, user["id"]),
        ).fetchone()
    if not row:
        raise HTTPException(404, "connector not found")
    config = json.loads(user_fernet(user["enc_key"]).decrypt(bytes(row[2])))
    return row[0], row[1], config


def _record_sync(connector_id: int, result: str):
    with db.connect() as conn:
        conn.execute(
            "UPDATE connectors SET last_sync = now(), last_result = %s WHERE id = %s",
            (result[:300], connector_id),
        )


def _supported(name: str, size) -> bool:
    return (
        os.path.splitext(name)[1].lower() in ALLOWED
        and (size is None or 0 < int(size) <= MAX_SIZE)
    )


# ---------- S3 ----------


class S3Config(BaseModel):
    access_key: str
    secret_key: str
    bucket: str
    region: str = "us-east-1"
    prefix: str = ""


def _s3_client(cfg: dict):
    import boto3

    return boto3.client(
        "s3",
        aws_access_key_id=cfg["access_key"],
        aws_secret_access_key=cfg["secret_key"],
        region_name=cfg.get("region") or "us-east-1",
    )


@router.post("/s3")
def connect_s3(body: S3Config, user: dict = Depends(current_user)):
    cfg = body.model_dump()
    try:
        _s3_client(cfg).list_objects_v2(Bucket=cfg["bucket"], Prefix=cfg["prefix"], MaxKeys=1)
    except Exception as e:
        raise HTTPException(400, f"couldn't access the bucket: {type(e).__name__}: {e}")
    cid = _save_config(user, "s3", cfg["bucket"], cfg)
    return {"id": cid, "label": cfg["bucket"]}


def _sync_s3(user: dict, connector_id: int, cfg: dict):
    client = _s3_client(cfg)
    new = skipped = failed = 0
    try:
        paginator = client.get_paginator("list_objects_v2")
        for page in paginator.paginate(Bucket=cfg["bucket"], Prefix=cfg.get("prefix", "")):
            for obj in page.get("Contents", []):
                if not _supported(obj["Key"], obj.get("Size")):
                    continue
                try:
                    data = client.get_object(Bucket=cfg["bucket"], Key=obj["Key"])["Body"].read()
                    doc_id, dup = ingest_bytes(user, obj["Key"].rsplit("/", 1)[-1], data)
                    if dup:
                        skipped += 1
                    else:
                        new += 1
                        process_document(doc_id, user["id"])
                except Exception:
                    failed += 1
        _record_sync(connector_id, f"synced: {new} new, {skipped} unchanged, {failed} failed")
    except Exception as e:
        _record_sync(connector_id, f"sync failed: {type(e).__name__}: {str(e)[:150]}")


# ---------- Google Drive ----------

GOOGLE_AUTH = "https://accounts.google.com/o/oauth2/v2/auth"
GOOGLE_TOKEN = "https://oauth2.googleapis.com/token"
DRIVE_API = "https://www.googleapis.com/drive/v3"
GDOC_MIME = "application/vnd.google-apps.document"


def _google_creds():
    cid = os.environ.get("GOOGLE_CLIENT_ID")
    secret = os.environ.get("GOOGLE_CLIENT_SECRET")
    if not cid or not secret:
        raise HTTPException(
            501,
            "Google Drive isn't configured yet: set GOOGLE_CLIENT_ID and"
            " GOOGLE_CLIENT_SECRET (OAuth client of type 'Web application' with"
            " redirect URI <app-url>/api/connectors/gdrive/callback).",
        )
    return cid, secret


def _redirect_uri(request: Request) -> str:
    base = str(request.base_url).rstrip("/")
    if "onrender.com" in base:  # Render terminates TLS before the app sees it
        base = base.replace("http://", "https://")
    return f"{base}/api/connectors/gdrive/callback"


def _token_request(payload: dict) -> dict:
    req = urllib.request.Request(
        GOOGLE_TOKEN,
        data=urllib.parse.urlencode(payload).encode(),
        headers={"Content-Type": "application/x-www-form-urlencoded"},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def _drive_get(access_token: str, url: str, raw: bool = False):
    req = urllib.request.Request(url, headers={"Authorization": f"Bearer {access_token}"})
    with urllib.request.urlopen(req, timeout=60) as r:
        body = r.read()
    return body if raw else json.loads(body)


@router.get("/gdrive/auth")
def gdrive_auth(request: Request, user: dict = Depends(current_user)):
    cid, _ = _google_creds()
    now = time.time()
    for k in [k for k, (_, t) in _oauth_states.items() if now - t > 600]:
        _oauth_states.pop(k, None)
    state = secrets.token_urlsafe(24)
    _oauth_states[state] = (user["id"], now)
    params = urllib.parse.urlencode(
        {
            "client_id": cid,
            "redirect_uri": _redirect_uri(request),
            "response_type": "code",
            "scope": "https://www.googleapis.com/auth/drive.readonly",
            "access_type": "offline",
            "prompt": "consent",
            "state": state,
        }
    )
    return {"url": f"{GOOGLE_AUTH}?{params}"}


@router.get("/gdrive/callback")
def gdrive_callback(request: Request, code: str = "", state: str = "", error: str = ""):
    entry = _oauth_states.pop(state, None)
    if not entry or time.time() - entry[1] > 600:
        raise HTTPException(400, "OAuth state expired — try connecting again")
    if error or not code:
        return RedirectResponse("/?drive=denied")
    user_id = entry[0]
    cid, secret = _google_creds()
    tokens = _token_request(
        {
            "code": code,
            "client_id": cid,
            "client_secret": secret,
            "redirect_uri": _redirect_uri(request),
            "grant_type": "authorization_code",
        }
    )
    refresh = tokens.get("refresh_token")
    if not refresh:
        raise HTTPException(400, "Google didn't return a refresh token — try again")
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id, email, enc_key FROM users WHERE id = %s", (user_id,)
        ).fetchone()
    user = {"id": row[0], "email": row[1], "enc_key": row[2]}
    _save_config(user, "gdrive", "Google Drive", {"refresh_token": refresh})
    return RedirectResponse("/?drive=connected")


def _sync_gdrive(user: dict, connector_id: int, cfg: dict):
    new = skipped = failed = 0
    try:
        cid, secret = (
            os.environ["GOOGLE_CLIENT_ID"],
            os.environ["GOOGLE_CLIENT_SECRET"],
        )
        access = _token_request(
            {
                "refresh_token": cfg["refresh_token"],
                "client_id": cid,
                "client_secret": secret,
                "grant_type": "refresh_token",
            }
        )["access_token"]
        page_token = ""
        while True:
            params = urllib.parse.urlencode(
                {
                    "q": "trashed=false",
                    "fields": "nextPageToken,files(id,name,mimeType,size)",
                    "pageSize": 100,
                    "pageToken": page_token,
                }
            )
            listing = _drive_get(access, f"{DRIVE_API}/files?{params}")
            for f in listing.get("files", []):
                is_gdoc = f["mimeType"] == GDOC_MIME
                if not is_gdoc and not _supported(f["name"], f.get("size")):
                    continue
                try:
                    if is_gdoc:
                        data = _drive_get(
                            access,
                            f"{DRIVE_API}/files/{f['id']}/export?mimeType=text/plain",
                            raw=True,
                        )
                        name = f["name"] + ".txt"
                    else:
                        data = _drive_get(access, f"{DRIVE_API}/files/{f['id']}?alt=media", raw=True)
                        name = f["name"]
                    if not data or len(data) > MAX_SIZE:
                        continue
                    doc_id, dup = ingest_bytes(user, name, data)
                    if dup:
                        skipped += 1
                    else:
                        new += 1
                        process_document(doc_id, user["id"])
                except Exception:
                    failed += 1
            page_token = listing.get("nextPageToken", "")
            if not page_token:
                break
        _record_sync(connector_id, f"synced: {new} new, {skipped} unchanged, {failed} failed")
    except Exception as e:
        _record_sync(connector_id, f"sync failed: {type(e).__name__}: {str(e)[:150]}")


# ---------- shared ----------


@router.get("")
def list_connectors(user: dict = Depends(current_user)):
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, kind, label, last_sync, last_result FROM connectors"
            " WHERE user_id = %s ORDER BY created_at",
            (user["id"],),
        ).fetchall()
    return [
        {
            "id": r[0], "kind": r[1], "label": r[2],
            "last_sync": r[3].isoformat() if r[3] else None,
            "last_result": r[4],
        }
        for r in rows
    ]


@router.post("/{connector_id}/sync")
def sync(connector_id: int, background: BackgroundTasks, user: dict = Depends(current_user)):
    kind, _, cfg = _load_config(user, connector_id)
    _record_sync(connector_id, "sync running…")
    if kind == "s3":
        background.add_task(_sync_s3, user, connector_id, cfg)
    else:
        background.add_task(_sync_gdrive, user, connector_id, cfg)
    return {"started": True}


@router.delete("/{connector_id}")
def disconnect(connector_id: int, user: dict = Depends(current_user)):
    with db.connect() as conn:
        gone = conn.execute(
            "DELETE FROM connectors WHERE id = %s AND user_id = %s RETURNING id",
            (connector_id, user["id"]),
        ).fetchone()
    if not gone:
        raise HTTPException(404, "connector not found")
    return {"ok": True}
