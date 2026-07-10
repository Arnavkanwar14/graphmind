import base64
import hashlib
import os
import secrets

from cryptography.fernet import Fernet
from fastapi import APIRouter, Depends, HTTPException, Request, Response
from pydantic import BaseModel

from . import db

router = APIRouter(prefix="/api/auth")

COOKIE = "session"


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
                " JOIN users u ON u.id = s.user_id WHERE s.token = %s",
                (token,),
            ).fetchone()
        if row:
            return {"id": row[0], "email": row[1], "enc_key": row[2]}
    raise HTTPException(401, "not logged in")


@router.post("/signup")
def signup(creds: Credentials, resp: Response):
    email = creds.email.strip().lower()
    if "@" not in email or len(creds.password) < 8:
        raise HTTPException(400, "valid email and password of 8+ characters required")
    token = secrets.token_hex(32)
    with db.connect() as conn:
        try:
            row = conn.execute(
                "INSERT INTO users (email, password_hash, enc_key)"
                " VALUES (%s, %s, %s) RETURNING id",
                (email, _hash_pw(creds.password), _wrapped_user_key()),
            ).fetchone()
        except Exception:
            raise HTTPException(409, "email already registered")
        conn.execute(
            "INSERT INTO sessions (token, user_id) VALUES (%s, %s)", (token, row[0])
        )
    _set_cookie(resp, token)
    return {"email": email}


@router.post("/login")
def login(creds: Credentials, resp: Response):
    email = creds.email.strip().lower()
    with db.connect() as conn:
        row = conn.execute(
            "SELECT id, password_hash FROM users WHERE email = %s", (email,)
        ).fetchone()
        if not row or not _check_pw(creds.password, row[1]):
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
