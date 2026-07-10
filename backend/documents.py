import hashlib
import io
import os

from cryptography.fernet import Fernet
from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, UploadFile
from psycopg import errors

from . import db
from .auth import current_user

router = APIRouter(prefix="/api/documents")

ALLOWED = {".md", ".txt", ".pdf"}
MAX_SIZE = 10 * 1024 * 1024
CHUNK_CHARS = 1500


def user_fernet(wrapped_key: str) -> Fernet:
    master = Fernet(os.environ["ENCRYPTION_KEY"].encode())
    return Fernet(master.decrypt(wrapped_key.encode()))


def _extract(filename: str, data: bytes) -> list[tuple[int | None, str]]:
    """Return [(page_no, text)] pieces."""
    if filename.lower().endswith(".pdf"):
        from pypdf import PdfReader

        reader = PdfReader(io.BytesIO(data))
        return [(i + 1, page.extract_text() or "") for i, page in enumerate(reader.pages)]
    return [(None, data.decode("utf-8", errors="replace"))]


def _chunk(pieces: list[tuple[int | None, str]]) -> list[tuple[int | None, str]]:
    """Split into ~CHUNK_CHARS chunks on paragraph boundaries, keeping page numbers."""
    out = []
    for page_no, text in pieces:
        buf = ""
        for para in text.split("\n\n"):
            para = para.strip()
            if not para:
                continue
            while len(para) > CHUNK_CHARS:  # hard-split oversized paragraphs
                out.append((page_no, para[:CHUNK_CHARS]))
                para = para[CHUNK_CHARS:]
            if len(buf) + len(para) + 2 > CHUNK_CHARS:
                if buf:
                    out.append((page_no, buf))
                buf = para
            else:
                buf = f"{buf}\n\n{para}" if buf else para
        if buf:
            out.append((page_no, buf))
    return out


def process_document(doc_id: int, user_id: int):
    try:
        with db.connect() as conn:
            row = conn.execute(
                "SELECT d.filename, d.blob_encrypted, u.enc_key FROM documents d"
                " JOIN users u ON u.id = d.user_id WHERE d.id = %s AND d.user_id = %s",
                (doc_id, user_id),
            ).fetchone()
            if not row:
                return
            filename, blob, wrapped_key = row
            data = user_fernet(wrapped_key).decrypt(bytes(blob))
            chunks = _chunk(_extract(filename, data))
            if not chunks:
                raise ValueError("no extractable text found")
            conn.execute(
                "UPDATE documents SET total_chunks = %s WHERE id = %s",
                (len(chunks), doc_id),
            )
            with conn.cursor() as cur:
                cur.executemany(
                    "INSERT INTO chunks (document_id, seq, page_no, text) VALUES (%s, %s, %s, %s)",
                    [(doc_id, i, p, t) for i, (p, t) in enumerate(chunks)],
                )
            conn.execute(
                "UPDATE documents SET status = 'processed', processed_chunks = %s WHERE id = %s",
                (len(chunks), doc_id),
            )
    except Exception as e:
        with db.connect() as conn:
            conn.execute(
                "UPDATE documents SET status = 'failed', error = %s WHERE id = %s",
                (str(e)[:500], doc_id),
            )


@router.post("")
async def upload(
    file: UploadFile,
    background: BackgroundTasks,
    user: dict = Depends(current_user),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    if ext not in ALLOWED:
        raise HTTPException(400, f"only {', '.join(sorted(ALLOWED))} files are supported")
    # read incrementally so an oversized body is rejected without buffering it all
    parts, size = [], 0
    while piece := await file.read(1024 * 1024):
        size += len(piece)
        if size > MAX_SIZE:
            raise HTTPException(400, "file exceeds the 10 MB limit")
        parts.append(piece)
    data = b"".join(parts)
    if not data:
        raise HTTPException(400, "file is empty")
    sha = hashlib.sha256(data).hexdigest()
    encrypted = user_fernet(user["enc_key"]).encrypt(data)
    with db.connect() as conn:
        dup = conn.execute(
            "SELECT id FROM documents WHERE user_id = %s AND sha256 = %s",
            (user["id"], sha),
        ).fetchone()
        if dup:
            return {"id": dup[0], "duplicate": True}
        try:
            row = conn.execute(
                "INSERT INTO documents (user_id, filename, size, sha256, blob_encrypted)"
                " VALUES (%s, %s, %s, %s, %s) RETURNING id",
                (user["id"], file.filename, len(data), sha, encrypted),
            ).fetchone()
        except errors.UniqueViolation:
            conn.rollback()
            dup = conn.execute(
                "SELECT id FROM documents WHERE user_id = %s AND sha256 = %s",
                (user["id"], sha),
            ).fetchone()
            return {"id": dup[0], "duplicate": True}
    background.add_task(process_document, row[0], user["id"])
    return {"id": row[0], "duplicate": False}


@router.get("")
def list_documents(user: dict = Depends(current_user)):
    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, filename, size, status, error, total_chunks, processed_chunks,"
            " created_at FROM documents WHERE user_id = %s ORDER BY created_at DESC",
            (user["id"],),
        ).fetchall()
    return [
        {
            "id": r[0], "filename": r[1], "size": r[2], "status": r[3],
            "error": r[4], "total_chunks": r[5], "processed_chunks": r[6],
            "created_at": r[7].isoformat(),
        }
        for r in rows
    ]


@router.get("/{doc_id}/chunks")
def document_chunks(doc_id: int, user: dict = Depends(current_user)):
    with db.connect() as conn:
        owner = conn.execute(
            "SELECT 1 FROM documents WHERE id = %s AND user_id = %s",
            (doc_id, user["id"]),
        ).fetchone()
        if not owner:
            raise HTTPException(404, "document not found")
        rows = conn.execute(
            "SELECT seq, page_no, text FROM chunks WHERE document_id = %s ORDER BY seq"
            " LIMIT 50",
            (doc_id,),
        ).fetchall()
    return [{"seq": r[0], "page_no": r[1], "text": r[2]} for r in rows]


@router.delete("/{doc_id}")
def delete_document(doc_id: int, user: dict = Depends(current_user)):
    with db.connect() as conn:
        gone = conn.execute(
            "DELETE FROM documents WHERE id = %s AND user_id = %s RETURNING id",
            (doc_id, user["id"]),
        ).fetchone()
    if not gone:
        raise HTTPException(404, "document not found")
    return {"ok": True}
