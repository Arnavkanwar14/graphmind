import os
import time

import psycopg

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    enc_key TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
"""


def connect():
    # Neon free tier suspends compute when idle; first connection can fail
    # while it wakes, so retry once.
    url = os.environ["DATABASE_URL"]
    try:
        return psycopg.connect(url, connect_timeout=10)
    except psycopg.OperationalError:
        time.sleep(3)
        return psycopg.connect(url, connect_timeout=15)


def init_db():
    with connect() as conn:
        conn.execute(SCHEMA)
