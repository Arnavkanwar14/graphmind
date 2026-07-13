"""Requeue and reprocess every 'failed' document, one at a time.

Guarded by a PID lock file so a second copy launched by accident (or a stale
one left over from a crashed run) can't run concurrently and clobber this
run's freshly-written chunks -- that happened once already (see CLAUDE.md).
"""

import atexit
import os
import subprocess
import sys
import time

LOCK_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "_retry.lock")


def _pid_alive(pid: int) -> bool:
    out = subprocess.run(
        ["tasklist", "/FI", f"PID eq {pid}"], capture_output=True, text=True
    ).stdout
    return str(pid) in out


def _acquire_lock():
    if os.path.exists(LOCK_PATH):
        with open(LOCK_PATH) as f:
            old_pid = f.read().strip()
        if old_pid.isdigit() and _pid_alive(int(old_pid)):
            print(f"another retry run is already alive (pid {old_pid}) -- exiting, not starting a duplicate")
            sys.exit(1)
        print(f"found a stale lock (pid {old_pid} is dead) -- clearing it")
    with open(LOCK_PATH, "w") as f:
        f.write(str(os.getpid()))
    atexit.register(lambda: os.path.exists(LOCK_PATH) and os.remove(LOCK_PATH))


def main():
    _acquire_lock()
    from backend import main as _boot  # noqa: F401  (loads .env as an import side effect)
    from backend import db, documents

    db.init_db()

    with db.connect() as conn:
        rows = conn.execute(
            "SELECT id, user_id FROM documents WHERE status = 'failed' ORDER BY id"
        ).fetchall()
    total = len(rows)
    print(f"{total} failed documents to retry")

    ok = 0
    still_failed = 0
    for i, (doc_id, user_id) in enumerate(rows, 1):
        with db.connect() as conn:
            claimed = conn.execute(
                "UPDATE documents SET status='uploaded', error=NULL,"
                " total_chunks=0, processed_chunks=0"
                " WHERE id=%s AND status='failed' RETURNING id",
                (doc_id,),
            ).fetchone()
        if not claimed:
            continue  # already picked up / reprocessed by something else
        t0 = time.time()
        documents.process_document(doc_id, user_id)
        with db.connect() as conn:
            status, error = conn.execute(
                "SELECT status, error FROM documents WHERE id=%s", (doc_id,)
            ).fetchone()
        dt = round(time.time() - t0, 1)
        if status == "processed":
            ok += 1
        else:
            still_failed += 1
        print(f"[{i}/{total}] doc {doc_id}: {status} ({dt}s)" + (f" - {error}" if error else ""))

    print(f"done: {ok} processed, {still_failed} still failed")


if __name__ == "__main__":
    main()
