from fastapi import APIRouter, Depends, HTTPException

from . import db
from .auth import current_user

router = APIRouter(prefix="/api/graph")

NODE_CAP = 500


@router.get("")
def graph(user: dict = Depends(current_user)):
    # One round trip, not four: over remote Neon each query is ~3ms of work but
    # ~250ms of network latency, so four sequential queries cost ~1.8s of pure
    # waiting. Bundling them as four json_agg subqueries returns the whole graph
    # in a single trip while Postgres still runs each part server-side.
    with db.connect() as conn:
        entities, docs, relations, mentions = conn.execute(
            "SELECT"
            " coalesce((SELECT json_agg(t) FROM (SELECT e.id, e.display_name, e.type,"
            "   (SELECT count(*) FROM edges x WHERE x.a_entity = e.id OR x.b_entity = e.id) deg"
            "   FROM entities e WHERE e.user_id = %(u)s ORDER BY deg DESC LIMIT %(cap)s) t), '[]'),"
            " coalesce((SELECT json_agg(t) FROM (SELECT id, filename FROM documents"
            "   WHERE user_id = %(u)s AND status != 'failed') t), '[]'),"
            " coalesce((SELECT json_agg(t) FROM (SELECT a_entity, b_entity, min(label) label FROM edges"
            "   WHERE user_id = %(u)s AND kind = 'relation' GROUP BY a_entity, b_entity) t), '[]'),"
            " coalesce((SELECT json_agg(t) FROM (SELECT DISTINCT a_entity, document_id FROM edges"
            "   WHERE user_id = %(u)s AND kind = 'mention') t), '[]')",
            {"u": user["id"], "cap": NODE_CAP},
        ).fetchone()

    included = {r["id"] for r in entities}
    nodes = [
        {"id": f"e{r['id']}", "name": r["display_name"], "type": r["type"], "degree": r["deg"]}
        for r in entities
    ] + [
        {"id": f"d{r['id']}", "name": r["filename"], "type": "document", "degree": 1}
        for r in docs
    ]
    links = [
        {"source": f"e{r['a_entity']}", "target": f"e{r['b_entity']}", "label": r["label"], "kind": "relation"}
        for r in relations
        if r["a_entity"] in included and r["b_entity"] in included
    ] + [
        {"source": f"d{r['document_id']}", "target": f"e{r['a_entity']}", "label": "mentions", "kind": "mention"}
        for r in mentions
        if r["a_entity"] in included
    ]
    return {"nodes": nodes, "links": links}


@router.get("/entity/{entity_id}")
def entity_detail(entity_id: int, user: dict = Depends(current_user)):
    # One round trip instead of four: this fires on every graph-node click, so
    # four serial queries meant ~1s of latency per click. Name/type stay scalar
    # (also the 404 check); relations, sources and mentions come back as arrays.
    with db.connect() as conn:
        r = conn.execute(
            "SELECT (SELECT display_name FROM entities WHERE id = %(e)s AND user_id = %(u)s),"
            " (SELECT type FROM entities WHERE id = %(e)s AND user_id = %(u)s),"
            " coalesce((SELECT json_agg(t) FROM (SELECT o.display_name other, x.label,"
            "   (x.a_entity = %(e)s) outbound FROM edges x"
            "   JOIN entities o ON o.id = CASE WHEN x.a_entity = %(e)s THEN x.b_entity ELSE x.a_entity END"
            "   WHERE x.user_id = %(u)s AND x.kind = 'relation'"
            "   AND (x.a_entity = %(e)s OR x.b_entity = %(e)s) LIMIT 30) t), '[]'),"
            " coalesce((SELECT json_agg(t) FROM (SELECT DISTINCT d.filename document, c.page_no,"
            "   left(c.text, 260) excerpt FROM edges x"
            "   JOIN chunks c ON c.id = x.chunk_id JOIN documents d ON d.id = x.document_id"
            "   WHERE x.user_id = %(u)s AND x.kind = 'relation'"
            "   AND (x.a_entity = %(e)s OR x.b_entity = %(e)s) LIMIT 6) t), '[]'),"
            " coalesce((SELECT json_agg(filename) FROM (SELECT DISTINCT d.filename FROM edges x"
            "   JOIN documents d ON d.id = x.document_id"
            "   WHERE x.user_id = %(u)s AND x.kind = 'mention' AND x.a_entity = %(e)s LIMIT 10) t), '[]')",
            {"e": entity_id, "u": user["id"]},
        ).fetchone()
    if r[0] is None:
        raise HTTPException(404, "entity not found")
    return {
        "name": r[0],
        "type": r[1],
        "relations": r[2],
        "sources": r[3],
        "documents": r[4],
    }
