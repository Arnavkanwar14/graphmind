import re
import time

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from fastapi import HTTPException

from . import db
from .auth import current_user
from .graphbuild import MODEL, check_budget, norm

router = APIRouter(prefix="/api/chat")

SYS = (
    "You are GraphMind, answering questions strictly from the user's own documents.\n"
    "Use ONLY the numbered SOURCES and the KNOWLEDGE GRAPH FACTS below. After every claim, "
    "cite the source it came from with its number in brackets, like [1] or [2]. Use the graph "
    "facts to connect information across documents, and mention the connecting relationship when "
    "you do. If the sources don't contain the answer, say so plainly — never invent. "
    "Keep answers concise."
)


class ChatIn(BaseModel):
    message: str
    history: list = []  # [{role, content}] most recent last


def _match_entities(conn, user_id: int, question: str):
    words = re.findall(r"[\w-]+", question.lower())
    grams = set()
    for n in (1, 2, 3):
        for i in range(len(words) - n + 1):
            g = norm(" ".join(words[i : i + n]))
            if len(g) >= 2:
                grams.add(g)
    if not grams:
        return []
    return conn.execute(
        "SELECT id, display_name FROM entities WHERE user_id = %s AND norm_key = ANY(%s)",
        (user_id, list(grams)),
    ).fetchall()


def _graph_context(conn, user_id: int, ent_ids: list):
    rows = conn.execute(
        "SELECT ea.display_name, x.label, eb.display_name, x.chunk_id FROM edges x"
        " JOIN entities ea ON ea.id = x.a_entity JOIN entities eb ON eb.id = x.b_entity"
        " WHERE x.user_id = %s AND x.kind = 'relation'"
        " AND (x.a_entity = ANY(%s) OR x.b_entity = ANY(%s)) LIMIT 40",
        (user_id, ent_ids, ent_ids),
    ).fetchall()
    triples = [f"{a} —{lbl}→ {b}" for a, lbl, b, _ in rows]
    chunk_ids = list({r[3] for r in rows if r[3] is not None})
    return triples, chunk_ids


def _fetch_chunks(conn, user_id: int, question: str, graph_chunk_ids: list):
    got, out = set(), []
    if graph_chunk_ids:
        for r in conn.execute(
            "SELECT c.id, d.filename, c.page_no, c.text, d.id FROM chunks c"
            " JOIN documents d ON d.id = c.document_id"
            " WHERE d.user_id = %s AND c.id = ANY(%s) LIMIT 5",
            (user_id, graph_chunk_ids),
        ).fetchall():
            if r[0] not in got:
                got.add(r[0])
                out.append(r)
    fts_hits = 0
    for r in conn.execute(
        "SELECT c.id, d.filename, c.page_no, c.text, d.id FROM chunks c"
        " JOIN documents d ON d.id = c.document_id, websearch_to_tsquery('english', %s) q"
        " WHERE d.user_id = %s AND c.ts @@ q ORDER BY ts_rank(c.ts, q) DESC LIMIT 8",
        (question, user_id),
    ).fetchall():
        fts_hits += 1
        if r[0] not in got and len(out) < 10:
            got.add(r[0])
            out.append(r)
    if fts_hits < 5:
        # strict search ANDs every term, which starves long questions — retry as OR
        words = {w for w in re.findall(r"[a-z0-9-]{4,}", question.lower())}
        if words:
            or_query = " OR ".join(list(words)[:12])
            for r in conn.execute(
                "SELECT c.id, d.filename, c.page_no, c.text, d.id FROM chunks c"
                " JOIN documents d ON d.id = c.document_id, websearch_to_tsquery('english', %s) q"
                " WHERE d.user_id = %s AND c.ts @@ q ORDER BY ts_rank(c.ts, q) DESC LIMIT 8",
                (or_query, user_id),
            ).fetchall():
                if r[0] not in got and len(out) < 10:
                    got.add(r[0])
                    out.append(r)
    return out


def _ask_groq(messages):
    from groq import Groq

    client = Groq()
    for attempt in range(4):
        try:
            resp = client.chat.completions.create(
                model=MODEL, temperature=0.2, messages=messages
            )
            return resp.choices[0].message.content
        except Exception as e:
            msg = str(e).lower()
            if "rate" in msg or "429" in msg or "503" in msg:
                time.sleep(10 * (attempt + 1))
                continue
            raise
    raise RuntimeError("Groq rate limit persisted")


@router.post("")
def chat(body: ChatIn, user: dict = Depends(current_user)):
    question = body.message.strip()[:2000]
    with db.connect() as conn:
        ents = _match_entities(conn, user["id"], question)
        ent_ids = [e[0] for e in ents]
        triples, graph_chunk_ids = (
            _graph_context(conn, user["id"], ent_ids) if ent_ids else ([], [])
        )
        chunks = _fetch_chunks(conn, user["id"], question, graph_chunk_ids)

    if not chunks:
        return {
            "answer": "I couldn't find anything in your documents about that. "
            "Try uploading more documents, or rephrasing the question.",
            "citations": [],
            "entities": [],
        }

    sources = "\n\n".join(
        f"[{i + 1}] {fn}{f' (p. {p})' if p is not None else ''}:\n{text[:900]}"
        for i, (_, fn, p, text, _) in enumerate(chunks)
    )
    facts = "\n".join(f"- {t}" for t in triples[:25]) or "- (none found)"
    context = f"KNOWLEDGE GRAPH FACTS:\n{facts}\n\nSOURCES:\n{sources}"

    messages = [{"role": "system", "content": f"{SYS}\n\n{context}"}]
    for m in body.history[-6:]:
        if m.get("role") in ("user", "assistant") and m.get("content"):
            messages.append({"role": m["role"], "content": str(m["content"])[:1500]})
    messages.append({"role": "user", "content": question})

    try:
        check_budget(user["id"])
    except RuntimeError as e:
        raise HTTPException(429, str(e))
    answer = _ask_groq(messages)
    return {
        "answer": answer,
        "citations": [
            {
                "n": i + 1,
                "chunk_id": cid,
                "document": fn,
                "page_no": p,
                "doc_id": did,
                "excerpt": text[:300],
            }
            for i, (cid, fn, p, text, did) in enumerate(chunks)
        ],
        "entities": [{"id": e[0], "name": e[1]} for e in ents],
    }
