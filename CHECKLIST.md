# GraphMind — completion checklist

Reference doc for "what's left." PLAN.md is the architecture/decisions record;
this is the punch list. Update it as items get done — check the box, don't
delete the line (keeps a record of what shipped).

Live: https://graphmind-r439.onrender.com · Working dir: `C:\Users\bifro\OneDrive\Desktop\graphmind`

## 1. Extraction pipeline reliability (in progress, 2026-07-13)

- [x] Groq stampede fix: process-wide `_groq_lock` serializes all extraction calls (`backend/graphbuild.py`)
- [x] Duplicate-worker chunk clobbering fix: atomic status claim in `process_document` (`backend/documents.py`)
- [x] Gemini fallback added (`_call_llm` in `graphbuild.py`) — tries Groq, falls to Gemini on rate-limit
- [x] **Neon idle-connection crash fixed** (2026-07-13): `psycopg_pool.ConnectionPool` had no health check, so a connection Neon closed server-side while idle would be handed out dead, crashing `process_document` with `OperationalError: server closed the connection unexpectedly`. Fixed with `check=ConnectionPool.check_connection` in `backend/db.py`. Verified: requeued and reprocessed a real failed doc (4 chunks) end-to-end, no crash.
- [x] Retry-script duplicate-process guard: `_retry_failed.py` now takes a PID lock file (`_retry.lock`) and refuses to start a second copy — closes the exact hazard that clobbered 282 docs' chunks on 2026-07-12.
- [x] **First retry pass run 2026-07-13** (task `b2k52adu9`, 260 docs attempted): 44 processed, 216 still failed. Overall document count: 165/381 processed, 216 failed. Every failure in the back half of the run was `429 RESOURCE_EXHAUSTED` from Gemini (its 20-req/day free quota burned out fast) with ~37s per attempt — meaning Groq was *also* rate-limited on those same docs before falling through to Gemini. Both providers' free daily quotas are exhausted for the day; this is a real provider-side cap, not a code bug.
- [ ] **216 documents still need reprocessing** — resume with the exact same command once quotas reset (likely a UTC day boundary):
  ```
  .venv/Scripts/python _retry_failed.py
  ```
  Safe to just rerun: the PID lock (`_retry.lock`) stops duplicates, and the atomic claim means only 'failed' docs get picked up. No need to requeue manually.
- [ ] Check status any time with:
  ```
  .venv/Scripts/python -c "from backend import main as _boot; from backend import db; print(db.connect().__enter__().execute(\"SELECT status, count(*) FROM documents GROUP BY status\").fetchall())"
  ```
- [ ] **Known real limit:** Gemini free tier is `generativelanguage.googleapis.com/generate_content_free_tier_requests` = 20/day for `gemini-flash-latest` — it is a small safety valve, not a real second lane. The backlog is bottlenecked on Groq's own free-tier daily cap. Expect this to take several more retry passes across multiple days to fully clear 216 docs at ~20-40 successful extractions/day. If clearing the full backlog matters more than staying free, a paid Groq/Gemini tier is the actual unblock — flag to Arnav before spending anything.
- [ ] One doc failed on `"Expecting ',' delimiter"` — a malformed-JSON response from the LLM, not a rate limit. If it recurs after retry, worth wrapping `_extract_groq`/`_extract_gemini`'s `json.loads` in a repair-retry (ask the model to fix its own JSON) rather than failing the whole doc.
- [ ] Once the retry finishes: confirm `processed` count and spot-check the Graph tab looks materially richer with the full 381-doc vault loaded, not just the ~120 that succeeded originally.

## 2. Google Drive connector — needs Arnav to finish E2E

- [x] OAuth client created (Web application type, Client ID/Secret in `.env`)
- [x] Auth URL generation verified live (curl returns a real Google consent URL)
- [ ] **Click through the actual consent screen on the live Render site** (not localhost — redirect URI only matches production) and confirm "Google Drive connected"
- [ ] Run a real Sync against a test Drive folder, confirm files ingest and the graph grows
- [ ] Confirm the Google Cloud OAuth consent screen has arnav's test account added under "Test users" (required while the app is in "Testing" publishing status)

## 3. S3 connector — needs an AWS test account

- [ ] Create a throwaway AWS account or IAM user with a scoped read-only key
- [ ] Connect a real bucket with a few files, Sync, confirm ingestion + graph growth
- [ ] Confirm bad/revoked credentials surface AWS's real error cleanly (already verified with intentionally-wrong keys — just needs the *real* success path checked too)

## 4. Production readiness gaps (SaaS, not demo)

- [ ] **Render Start Command**: confirm `--proxy-headers --forwarded-allow-ips=*` was added (needed so request.base_url resolves https behind Render's proxy — affects password-reset links and OAuth redirect URIs). Asked earlier, never confirmed back.
- [ ] Email verification + real transactional email (Resend free tier suggested). Password reset already works but falls back to a server-log link without `RESEND_API_KEY` set.
- [ ] Error monitoring (Sentry free tier) — right now a crash is only visible via Render logs or the `documents.error` column.
- [ ] ToS / privacy policy pages (needed before any real signups, not just Arnav's test accounts).
- [ ] Billing (Stripe) — no pricing/paywall exists yet; every account currently gets the same free Groq-budget-limited access.
- [ ] Per-user daily Groq budget (`DAILY_GROQ_CALLS = 400`) is in-memory, resets on process restart, single-instance only — fine for one Render dyno, revisit if this ever scales beyond one.

## 5. Testing coverage (currently all manual/live verification, no automated tests)

- [ ] No automated test suite exists anywhere in the repo — everything so far has been verified by hand (curl, live UI clicks, direct DB queries). Worth at minimum:
  - [ ] A pytest smoke test for `_call_llm`'s Groq→Gemini fallback logic using mocked clients (verify it actually falls over on a simulated 429, and re-raises non-rate-limit errors)
  - [ ] A test for the atomic claim guard in `process_document` (two concurrent calls on the same doc_id — second is a no-op)
  - [ ] A test for `norm()` entity-name normalization (the dedupe logic silently governs graph quality — "OpenAI" / "Open AI" / "OpenAI Inc." collapsing correctly is easy to regress)
- [ ] Multi-tenancy isolation was manually verified with a second test account (zero cross-contamination) — not automated, worth a regression test given every table's safety depends on `user_id` filtering being present on every query.
- [ ] No load/volume test beyond the accidental 381-doc real-world one currently underway.

## 6. Nice-to-haves explicitly deferred (see PLAN.md "Upgrade path" — don't pull forward without a real reason)

Hybrid retrieval (pgvector + embeddings), streaming chat, entity merging via embeddings, KMS-managed keys, teams/roles/permissions, graph summarization for 100k+ node graphs, conversation memory beyond last 6 messages, Celery/Redis queue, continuous connector sync.

## How to use this file

- Check a box when verified live (ran it, saw it work) — not when the code merely looks right.
- If a fix changes behavior other sessions should know about, also add one line to `CLAUDE.md`'s gotcha log.
- Re-read PLAN.md's "Decisions and rejected alternatives" table before reversing any architecture choice listed here.
