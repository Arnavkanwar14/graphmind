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
CREATE TABLE IF NOT EXISTS documents (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    filename TEXT NOT NULL,
    size INT NOT NULL,
    sha256 TEXT NOT NULL,
    blob_encrypted BYTEA NOT NULL,
    status TEXT NOT NULL DEFAULT 'uploaded',
    error TEXT,
    total_chunks INT NOT NULL DEFAULT 0,
    processed_chunks INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (user_id, sha256)
);
CREATE TABLE IF NOT EXISTS chunks (
    id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    document_id BIGINT NOT NULL REFERENCES documents(id) ON DELETE CASCADE,
    seq INT NOT NULL,
    page_no INT,
    text TEXT NOT NULL,
    ts tsvector GENERATED ALWAYS AS (to_tsvector('english', text)) STORED
);
CREATE INDEX IF NOT EXISTS chunks_ts_idx ON chunks USING GIN (ts);
CREATE INDEX IF NOT EXISTS chunks_doc_idx ON chunks (document_id);
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
