import os

from psycopg_pool import ConnectionPool

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


_pool = None


def connect():
    # pooled: avoids a fresh TLS handshake to Neon on every request; the pool
    # also retries internally while Neon's suspended compute wakes up
    global _pool
    if _pool is None:
        _pool = ConnectionPool(
            os.environ["DATABASE_URL"],
            min_size=0,
            max_size=4,
            kwargs={"connect_timeout": 15},
            open=True,
        )
    return _pool.connection()


def init_db():
    with connect() as conn:
        conn.execute(SCHEMA)
