import base64
import hashlib
import os
import secrets

from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from psycopg import errors
from pydantic import BaseModel

from . import db

router = APIRouter(prefix="/api/auth")

COOKIE = "session"

# ponytail: in-memory per-IP throttle; single instance, resets on restart
_attempts: dict = {}
RATE_MAX, RATE_WINDOW = 10, 300  # attempts per seconds


def _throttle(request: Request):
    import time

    ip = request.client.host if request.client else "?"
    now = time.time()
    if len(_attempts) > 10000:  # prune stale IPs before the dict becomes the problem
        for k in [k for k, ts in _attempts.items() if not ts or now - ts[-1] > RATE_WINDOW]:
            _attempts.pop(k, None)
    recent = [t for t in _attempts.get(ip, []) if now - t < RATE_WINDOW]
    if len(recent) >= RATE_MAX:
        raise HTTPException(429, "too many attempts — wait a few minutes")
    recent.append(now)
    _attempts[ip] = recent


def _hash_pw(pw: str) -> str:
    salt = secrets.token_bytes(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1)
    return base64.b64encode(salt + h).decode()


def _check_pw(pw: str, stored: str) -> bool:
    raw = base64.b64decode(stored)
    salt, h = raw[:16], raw[16:]
    return secrets.compare_digest(
        hashlib.scrypt(pw.encode(), salt=salt, n=2**14, r=8, p=1), h
    )


def _wrapped_user_key() -> str:
    # envelope encryption: per-user Fernet key, wrapped by the master key
    master = Fernet(os.environ["ENCRYPTION_KEY"].encode())
    return master.encrypt(Fernet.generate_key()).decode()


class Credentials(BaseModel):
    email: str
    password: str


def _set_cookie(resp: Response, token: str):
    resp.set_cookie(
        COOKIE, token, httponly=True, samesite="lax",
        secure=bool(os.environ.get("RENDER")), max_age=30 * 86400,
    )


def current_user(request: Request) -> dict:
    token = request.cookies.get(COOKIE)
    if token:
        with db.connect() as conn:
            row = conn.execute(
                "SELECT u.id, u.email, u.enc_key FROM sessions s"
                " JOIN users u ON u.id = s.user_id WHERE s.token = %s"
                " AND s.created_at > now() - interval '30 days'",
                (token,),
            ).fetchone()
        if row:
            return {"id": row[0], "email": row[1], "enc_key": row[2]}
    raise HTTPException(401, "not logged in")


@router.post("/signup")
def signup(creds: Credentials, resp: Response, request: Request):
    _throttle(request)
    email = creds.email.strip().lower()
    if "@" not in email or not 8 <= len(creds.password) <= 256:
        raise HTTPException(400, "valid email and password of 8-256 characters required")
    token = secrets.token_hex(32)
    with db.connect() as conn:
        try:
            row = conn.execute(
                "INSERT INTO users (email, password_hash, enc_key)"
                " VALUES (%s, %s, %s) RETURNING id",
                (email, _hash_pw(creds.password), _wrapped_user_key()),
            ).fetchone()
        except errors.UniqueViolation:
            raise HTTPException(409, "email already registered")
        conn.execute(
            "INSERT INTO sessions (token, user_id) VALUES (%s, %s)", (token, row[0])
        )
    _set_cookie(resp, token)
    return {"email": email}


@router.post("/login")
def login(creds: Credentials, resp: Response, request: Request):
    _throttle(request)
    email = creds.email.strip().lower()
    if len(creds.password) > 256:
        raise HTTPException(401, "wrong email or password")
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE email = %s", (email,)
        ).fetchone()
        if not row:
            _hash_pw(creds.password)  # equalize timing so unknown emails aren't faster
            raise HTTPException(401, "wrong email or password")
        if not _check_pw(creds.password, row[1]):
            raise HTTPException(401, "wrong email or password")
        token = secrets.token_hex(32)
        conn.execute(
            "INSERT INTO sessions (token, user_id) VALUES (%s, %s)", (token, row[0])
        )
    _set_cookie(resp, token)
    return {"email": email}


@router.post("/logout")
def logout(request: Request, resp: Response):
    token = request.cookies.get(COOKIE)
    if token:
        with db.connect() as conn:
            conn.execute("DELETE FROM sessions WHERE token = %s", (token,))
    resp.delete_cookie(COOKIE)
    return {"ok": True}


@router.get("/me")
def me(user: dict = Depends(current_user)):
    return {"id": user["id"], "email": user["email"]}


def _send_reset_email(email: str, link: str):
    key = os.environ.get("RESEND_API_KEY")
    if not key:
        # no email provider configured yet — surface the link in server logs
        print(f"[password reset] {email}: {link}", flush=True)
        return
    import json as _json
    import urllib.request

    req = urllib.request.Request(
        "https://api.resend.com/emails",
        data=_json.dumps(
            {
                "from": os.environ.get("RESET_FROM", "GraphMind <onboarding@resend.dev>"),
                "to": [email],
                "subject": "Reset your GraphMind password",
                "text": f"Someone (hopefully you) asked to reset your GraphMind password.\n\n"
                f"Reset it here (valid 1 hour): {link}\n\nIf this wasn't you, ignore this email.",
            }
        ).encode(),
        headers={"Authorization": f"Bearer {key}", "Content-Type": "application/json"},
    )
    urllib.request.urlopen(req, timeout=20)


class ForgotIn(BaseModel):
    email: str


class ResetIn(BaseModel):
    token: str
    password: str


@router.post("/forgot")
def forgot(body: ForgotIn, request: Request):
    _throttle(request)
    email = body.email.strip().lower()
    with db.connect() as conn:
        row = conn.execute("SELECT id FROM users WHERE email = %s", (email,)).fetchone()
        if row:
            token = secrets.token_urlsafe(32)
            conn.execute(
                "INSERT INTO password_resets (token, user_id) VALUES (%s, %s)", (token, row[0])
            )
            base = str(request.base_url).rstrip("/")
            if "onrender.com" in base:
                base = base.replace("http://", "https://")
            try:
                _send_reset_email(email, f"{base}/?reset={token}")
            except Exception:
                pass  # never reveal delivery problems to the caller
    return {"ok": True}  # same answer whether or not the account exists


@router.post("/reset")
def reset(body: ResetIn, request: Request):
    _throttle(request)
    if not 8 <= len(body.password) <= 256:
        raise HTTPException(400, "password must be 8-256 characters")
    with db.connect() as conn:
        row = conn.execute(
            "SELECT user_id FROM password_resets WHERE token = %s"
            " AND created_at > now() - interval '1 hour'",
            (body.token,),
        ).fetchone()
        if not row:
            raise HTTPException(400, "reset link is invalid or expired — request a new one")
        conn.execute(
            "UPDATE users SET password_hash = %s WHERE id = %s",
            (_hash_pw(body.password), row[0]),
        )
        conn.execute("DELETE FROM password_resets WHERE user_id = %s", (row[0],))
        conn.execute("DELETE FROM sessions WHERE user_id = %s", (row[0],))
    return {"ok": True}


@router.delete("/account")
def delete_account(resp: Response, user: dict = Depends(current_user)):
    # cascades take documents, chunks, entities, edges, sessions, connectors
    with db.connect() as conn:
        conn.execute("DELETE FROM users WHERE id = %s", (user["id"],))
    resp.delete_cookie(COOKIE)
    return {"ok": True}
