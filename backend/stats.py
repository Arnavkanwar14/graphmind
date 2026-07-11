from fastapi import APIRouter, Depends

from . import db
from .auth import current_user

router = APIRouter(prefix="/api/stats")


@router.get("")
def stats(user: dict = Depends(current_user)):
    uid = user["id"]
    with db.connect() as conn:
        counts = conn.execute(
            "SELECT (SELECT count(*) FROM documents WHERE user_id = %(u)s),"
            " (SELECT coalesce(sum(total_chunks), 0) FROM documents WHERE user_id = %(u)s),"
            " (SELECT count(*) FROM entities WHERE user_id = %(u)s),"
            " (SELECT count(*) FROM edges WHERE user_id = %(u)s AND kind = 'relation')",
            {"u": uid},
        ).fetchone()
        by_day = conn.execute(
            "SELECT to_char(date(created_at), 'YYYY-MM-DD'), count(*) FROM documents"
            " WHERE user_id = %s AND created_at > now() - interval '14 days'"
            " GROUP BY 1 ORDER BY 1",
            (uid,),
        ).fetchall()
        top_docs = conn.execute(
            "SELECT filename, total_chunks FROM documents"
            " WHERE user_id = %s AND status = 'processed'"
            " ORDER BY total_chunks DESC LIMIT 8",
            (uid,),
        ).fetchall()
        types = conn.execute(
            "SELECT type, count(*) FROM entities WHERE user_id = %s"
            " GROUP BY 1 ORDER BY 2 DESC",
            (uid,),
        ).fetchall()
        top_entities = conn.execute(
            "SELECT e.display_name, e.type,"
            " (SELECT count(*) FROM edges x WHERE x.a_entity = e.id OR x.b_entity = e.id) deg"
            " FROM entities e WHERE e.user_id = %s ORDER BY deg DESC LIMIT 8",
            (uid,),
        ).fetchall()
    return {
        "documents": counts[0],
        "chunks": counts[1],
        "entities": counts[2],
        "relations": counts[3],
        "by_day": [{"day": d, "count": c} for d, c in by_day],
        "top_docs": [{"name": n, "chunks": c} for n, c in top_docs],
        "types": [{"type": t, "count": c} for t, c in types],
        "top_entities": [{"name": n, "type": t, "degree": d} for n, t, d in top_entities],
    }
