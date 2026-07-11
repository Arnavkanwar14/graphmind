"""LLM extraction: chunks -> entities + relations, batched to spare the free Groq tier."""

import json
import os
import re
import time

from . import db

MODEL = "llama-3.3-70b-versatile"
BATCH = 5
TYPES = {"person", "org", "product", "concept", "place"}

# ponytail: in-memory per-user daily Groq budget; single instance, resets on
# restart — swap for a DB counter if this ever scales past one dyno
DAILY_GROQ_CALLS = 400
_budget: dict = {}


def check_budget(user_id: int, calls: int = 1):
    import datetime

    key = (user_id, datetime.date.today().isoformat())
    used = _budget.get(key, 0)
    if used + calls > DAILY_GROQ_CALLS:
        raise RuntimeError("daily AI budget reached — try again tomorrow")
    _budget[key] = used + calls

_PUNCT = re.compile(r"[^\w\s-]")
_SUFFIX = re.compile(r"\s+(inc|llc|corp|ltd|co)$")

SYS = (
    "You extract knowledge graphs from document excerpts. Respond only with JSON:\n"
    '{"entities": [{"name": str, "type": "person"|"org"|"product"|"concept"|"place"}],\n'
    ' "relations": [{"source": str, "target": str, "label": str, "chunk": int}]}\n'
    "entities: the distinct named things (products, companies, people, technical concepts, places) "
    "that this text is actually about — skip generic words. ALWAYS include the document's main "
    "topic itself as a concept entity (e.g. a page about function calling gets a 'function calling' entity). "
    "relations: direct relationships stated in the text between those entities; label is a short "
    "verb phrase (e.g. 'runs on', 'part of', 'created by'); chunk is the [chunk N] number it came from. "
    "At most 15 entities and 15 relations per response. Only what the text supports."
)


def norm(name: str) -> str:
    n = _PUNCT.sub("", name.lower()).strip()
    n = _SUFFIX.sub("", n)
    return re.sub(r"\s+", " ", n).strip()


def _call_groq(client, doc_title: str, batch):
    numbered = "\n\n".join(f"[chunk {i}]\n{text[:1400]}" for i, (_, text) in enumerate(batch))
    for attempt in range(5):
        try:
            resp = client.chat.completions.create(
                model=MODEL,
                temperature=0,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": SYS},
                    {"role": "user", "content": f'Document: "{doc_title}"\n\n{numbered}'},
                ],
            )
            return json.loads(resp.choices[0].message.content)
        except Exception as e:
            msg = str(e).lower()
            if "rate" in msg or "429" in msg or "503" in msg:
                time.sleep(12 * (attempt + 1))
                continue
            raise
    raise RuntimeError("Groq rate limit persisted after retries")


def _upsert_entity(conn, user_id, name, typ):
    key = norm(name)
    if len(key) < 2 or len(key) > 120:
        return None
    row = conn.execute(
        "INSERT INTO entities (user_id, norm_key, display_name, type) VALUES (%s, %s, %s, %s)"
        " ON CONFLICT (user_id, norm_key) DO UPDATE SET norm_key = EXCLUDED.norm_key"
        " RETURNING id",
        (user_id, key, name.strip()[:120], typ if typ in TYPES else "concept"),
    ).fetchone()
    return row[0]


def extract_document(doc_id: int, user_id: int):
    """Build graph edges for one processed document. Idempotent via dedup inserts."""
    if not os.environ.get("GROQ_API_KEY"):
        return
    from groq import Groq

    client = Groq()
    with db.connect() as conn:
        title_row = conn.execute(
            "SELECT filename FROM documents WHERE id = %s AND user_id = %s", (doc_id, user_id)
        ).fetchone()
        if not title_row:
            return
        chunks = conn.execute(
            "SELECT id, text FROM chunks WHERE document_id = %s ORDER BY seq", (doc_id,)
        ).fetchall()
    title = title_row[0]

    done = 0
    for i in range(0, len(chunks), BATCH):
        batch = chunks[i : i + BATCH]
        check_budget(user_id)
        data = _call_groq(client, title, batch)
        with db.connect() as conn:
            ids = {}
            for ent in data.get("entities", [])[:20]:
                name = str(ent.get("name", ""))
                eid = _upsert_entity(conn, user_id, name, str(ent.get("type", "")))
                if eid is None:
                    continue
                ids[norm(name)] = eid
                conn.execute(
                    "INSERT INTO edges (user_id, kind, a_entity, document_id)"
                    " SELECT %(u)s, 'mention', %(e)s, %(d)s WHERE NOT EXISTS"
                    " (SELECT 1 FROM edges WHERE user_id = %(u)s AND kind = 'mention'"
                    "  AND a_entity = %(e)s AND document_id = %(d)s)",
                    {"u": user_id, "e": eid, "d": doc_id},
                )
            for rel in data.get("relations", [])[:20]:
                a = ids.get(norm(str(rel.get("source", ""))))
                b = ids.get(norm(str(rel.get("target", ""))))
                label = str(rel.get("label", "related to")).strip()[:80]
                if not a or not b or a == b:
                    continue
                try:
                    ci = int(rel.get("chunk", -1))
                except (TypeError, ValueError):
                    ci = -1
                chunk_id = batch[ci][0] if 0 <= ci < len(batch) else batch[0][0]
                conn.execute(
                    "INSERT INTO edges (user_id, kind, a_entity, b_entity, document_id, chunk_id, label)"
                    " SELECT %(u)s, 'relation', %(a)s, %(b)s, %(d)s, %(c)s, %(l)s WHERE NOT EXISTS"
                    " (SELECT 1 FROM edges WHERE user_id = %(u)s AND kind = 'relation'"
                    "  AND a_entity = %(a)s AND b_entity = %(b)s AND label = %(l)s AND document_id = %(d)s)",
                    {"u": user_id, "a": a, "b": b, "d": doc_id, "c": chunk_id, "l": label},
                )
            done += len(batch)
            conn.execute(
                "UPDATE documents SET processed_chunks = %s WHERE id = %s", (done, doc_id)
            )
