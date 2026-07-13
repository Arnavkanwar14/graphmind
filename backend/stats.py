from fastapi import APIRouter, Depends

from . import db
from .auth import current_user

router = APIRouter(prefix="/api/stats")


@router.get("")
def stats(user: dict = Depends(current_user)):
    uid = user["id"]
    # One round trip instead of five: on remote Neon each query is a few ms of
    # work but ~250ms of network latency, so five serial queries cost ~1.8s of
    # waiting. Counts stay scalar; the chart series come back as json_agg arrays.
    with db.connect() as conn:
        r = conn.execute(
            "SELECT (SELECT count(*) FROM documents WHERE user_id = %(u)s),"
            " (SELECT coalesce(sum(total_chunks), 0) FROM documents WHERE user_id = %(u)s),"
            " (SELECT count(*) FROM entities WHERE user_id = %(u)s),"
            " (SELECT count(*) FROM edges WHERE user_id = %(u)s AND kind = 'relation'),"
            " coalesce((SELECT json_agg(t) FROM (SELECT to_char(date(created_at), 'YYYY-MM-DD') AS \"day\","
            "   count(*) AS \"count\" FROM documents WHERE user_id = %(u)s"
            "   AND created_at > now() - interval '14 days' GROUP BY 1 ORDER BY 1) t), '[]'),"
            " coalesce((SELECT json_agg(t) FROM (SELECT filename AS name, total_chunks AS chunks FROM documents"
            "   WHERE user_id = %(u)s AND status = 'processed' ORDER BY total_chunks DESC LIMIT 8) t), '[]'),"
            " coalesce((SELECT json_agg(t) FROM (SELECT type, count(*) AS \"count\" FROM entities"
            "   WHERE user_id = %(u)s GROUP BY 1 ORDER BY 2 DESC) t), '[]'),"
            " coalesce((SELECT json_agg(t) FROM (SELECT e.display_name name, e.type,"
            "   (SELECT count(*) FROM edges x WHERE x.a_entity = e.id OR x.b_entity = e.id) degree"
            "   FROM entities e WHERE e.user_id = %(u)s ORDER BY degree DESC LIMIT 8) t), '[]')",
            {"u": uid},
        ).fetchone()
    return {
        "documents": r[0],
        "chunks": r[1],
        "entities": r[2],
        "relations": r[3],
        "by_day": r[4],
        "top_docs": r[5],
        "types": r[6],
        "top_entities": r[7],
    }
