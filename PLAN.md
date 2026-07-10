# GraphMind — AI knowledge graphs for companies

## Handoff block (paste-first context for any fresh session)

GraphMind is a SaaS web app: a company signs up, uploads its documents (later: connects S3 / Google Drive), the backend encrypts and stores them, extracts text, and uses an LLM to build a knowledge graph (entities + relations across documents). The user explores the graph visually and chats with their docs — and the graph is part of retrieval, not just visualization: answers are found by traversing entity relationships, then cited back to exact source chunks. That's the differentiator vs. Copilot/NotebookLM/Glean — relationship discovery and explainable, graph-backed answers, not "another chat with your documents."

**Stack (decided, don't relitigate):** FastAPI (Python 3.10, own venv) serving a built React/Vite frontend from one process — one Render free-tier deploy, no CORS. Postgres on Neon free tier (Render's free disk is ephemeral, so nothing durable lives on it). Groq for all LLM calls (Arnav's free key). Postgres full-text search for retrieval in MVP — no embeddings/vector DB yet. Graph viz: react-force-graph-2d. Auth: email+password, `hashlib.scrypt` (stdlib — no passlib/bcrypt dep) + a `sessions` table with `secrets.token_hex` cookie (no JWT lib; revocation = DELETE row). File blobs encrypted with Fernet (`ENCRYPTION_KEY` env), stored as bytea in Postgres, 10 MB/file cap.

**Dependency budget (ponytail rule):** backend = fastapi, uvicorn, psycopg, cryptography, pypdf, groq, python-multipart (FastAPI requires it to parse multipart uploads — no stdlib alternative), psycopg_pool (per-request TLS handshakes to remote Neon added ~100-300ms to every endpoint — 2026-07-10 code review). Frontend = react, react-force-graph-2d. Anything beyond this list needs a reason written into this file.

**Owner's standing rules:** free tiers only, keys in gitignored `.env` (committed `.env.example`), commit+push each verified feature, smallest change that solves the step, "done" = ran it and saw it work.

**Status (2026-07-11):** Stages 0–3 done and verified — live at https://graphmind-r439.onrender.com (Render free + Neon free). Auth, encrypted ingestion (tested with Baseten docs vault), and the knowledge graph all work end to end: batched Groq extraction (5 chunks/call, llama-3.3-70b) produces sane triples, Graph tab renders force-directed viz with entity detail panel. All 10 code-review findings fixed. UI reworked to match Retool reference (announcement bar, shimmer, motion, stats strip, dropzone). Stage 4 done too (2026-07-11): chat answers via entity-match → 1-hop traversal → chunk union with FTS (websearch + OR fallback), citations as clickable pills, "in the graph" chips jump to the Graph tab focused on the entity. Verified cross-document: "which engines support function calling?" answered correctly citing 3 docs. Next: Stage 5 (S3 connector — blocked on AWS account) or Stage 7 hardening. Working dir: `C:\Users\bifro\OneDrive\Desktop\graphmind`.

## Decisions and rejected alternatives

| Decision | Chose | Rejected | Why |
|---|---|---|---|
| Architecture | FastAPI serves built React statically (one service) | Separate Vercel frontend + Render backend | One deploy, one URL, no CORS/cookie-domain pain; can split later if needed |
| Database | Neon Postgres (free) | SQLite on Render; Supabase | Render free disk is wiped on every deploy — SQLite there loses all data. Neon is pure Postgres, no lock-in. Supabase bundles auth/storage we're building ourselves |
| Retrieval | Postgres FTS (`tsvector`) | Embeddings + pgvector from day 1 | Groq has no embedding API; local embedding models strain a 512 MB free dyno. FTS is zero-dependency and good on docs; embeddings are a listed upgrade, not a foundation |
| Graph building | Groq LLM extracts entities/relations per chunk | Pure keyword co-occurrence | Co-occurrence graphs are noise; LLM extraction is the actual product ("AI-enabled"). Co-occurrence kept as fallback if Groq rate-limits (tripwire below) |
| File storage | Encrypted bytea in Postgres, 10 MB cap | S3 from day 1 | No AWS account exists yet. Postgres bytea is durable and free; swap to S3 behind the same interface when the account exists |
| Connectors | Upload first; S3 stage 5; Drive stage 6 | All three in MVP | No AWS/GCloud accounts yet; Drive OAuth verification is its own mini-project. Upload proves the whole pipeline |
| Auth plumbing | stdlib scrypt + sessions table | JWT + passlib | Two fewer deps; a sessions table is trivially revocable, JWT isn't. Same UX |
| File types | .md/.txt/.pdf only | .docx in MVP | python-docx is a dep for a format the demo doesn't need. Add when a real user asks |
| Retrieval design | Graph traversal + FTS union | FTS-only with graph as viz | If the graph doesn't influence answers, 95% of extraction cost is decoration. Traversal is ~30 lines and IS the product (2026-07-10 review) |
| Extraction calls | ~5 chunks batched per Groq call, doc title in prompt | One call per chunk | 5× fewer calls on a shared free key AND cross-chunk context so relations spanning chunks aren't lost |
| Encryption | Envelope: master key wraps per-user Fernet keys | Single Fernet key for all users | ~15 lines more now; key rotation possible; one leaked user key ≠ every customer's data. Migrating later means re-encrypting everything |
| Deletion | FKs with ON DELETE CASCADE everywhere | Rebuild graph on doc delete | Schema decision, zero code: deleting a doc cleanly drops its chunks/edges/orphans |

## Stages

Each stage ends with something you can SEE on the live URL. Verify lines are commands/flows, not code-reading.

---

### Stage 0 — Walking skeleton, live (one session)

**Goal:** `https://<app>.onrender.com` serves a React page from FastAPI; `/api/health` returns DB-connected status. Repo on GitHub, auto-deploys from main.

Steps:
1. **Scaffold.** `backend/` (FastAPI, `/api/health` querying `SELECT 1` on Neon), `frontend/` (Vite React, landing page), FastAPI mounts `frontend/dist`. `.env` + `.env.example` (`DATABASE_URL`, `GROQ_API_KEY`, `ENCRYPTION_KEY`). `render.yaml` only (build command lives in it — no separate build.sh).
   - *Where:* whole repo skeleton.
   - *Verify:* locally `uvicorn` serves the React page and `/api/health` → `{"db": "ok"}`.
   - *Fence:* no auth, no models beyond a ping table, no styling beyond a title.
2. **Accounts + deploy.** Arnav creates Neon + Render free accounts (needs human: email signups). Connect repo, set env vars in Render dashboard.
   - *Verify:* live URL shows the page; `/api/health` → `{"db": "ok"}` from the internet. **This is the stage gate.**
   - *Fence:* don't touch app code to fix deploy issues except build script/config.

### Stage 1 — Accounts (one session)

**Goal:** a stranger can sign up, log in, log out; sessions survive refresh.

1. **Auth backend.** `users` table (id, email, password_hash, created_at) + `sessions` table (token, user_id, created_at); `/api/auth/signup|login|logout|me`; `hashlib.scrypt` for hashing, `secrets.token_hex(32)` httpOnly cookie.
   - *Verify:* `curl` signup → login → `/me` returns the email; wrong password → 401.
   - *Fence:* no password reset, no email verification, no OAuth login — MVP is email+password only.
2. **Auth UI.** Signup/login forms, logged-in shell with nav (Documents / Graph / Chat placeholders), logout.
   - *Verify:* on the live URL, create account in a private browser window, refresh, still logged in.
   - *Fence:* no CSS framework bikeshedding — pick one look (plain dark theme) and stop.

### Stage 2 — Ingest: upload → encrypted store → extracted text (one session)

**Goal:** user uploads files, sees them listed with status "processed", and can preview extracted text.

1. **Upload + encrypt.** `documents` table (id, user_id, filename, mime, size, sha256, blob_encrypted, status, created_at) — same sha256 for same user = skip re-upload. Envelope encryption: `users.enc_key` is a per-user Fernet key wrapped by `ENCRYPTION_KEY`; doc blobs encrypted with the user key. Accept .md/.txt/.pdf (no .docx — see decisions), cap 10 MB. All child tables FK with ON DELETE CASCADE.
   - *Verify:* upload a PDF via the UI; row appears; `psql` shows blob is not plaintext (no readable strings).
   - *Fence:* no folders/tags, no multi-file zip handling, no S3.
2. **Extract + chunk.** On upload (FastAPI BackgroundTask — no Celery/queue): decrypt → extract text (pypdf or plain read) → split into ~1,500-char chunks on paragraph boundaries → `chunks` table (id, document_id FK CASCADE, seq, page_no nullable, text, tsvector column + GIN index). `page_no` from pypdf so citations can say "p. 4". Progress = `documents.total_chunks` + `processed_chunks`, UI polls it. Status: uploaded → processed / failed(reason).
   - *Verify:* upload the Baseten vault's README + 2 PDFs; documents page shows "processed" and clicking one previews its chunks; `SELECT count(*) FROM chunks` > 0.
   - *Fence:* no OCR for scanned PDFs (mark failed with honest reason); no language detection; no queue infra.

### Stage 3 — The knowledge graph (heart of the product; 1–2 sessions)

**Goal:** "Graph" page shows an interactive force-directed graph of the user's documents — entity nodes colored by type, document nodes, edges with relation labels; click a node → its source chunks.

1. **Extraction pipeline.** Batch ~5 chunks per Groq call (llama-3.3-70b, JSON mode), document title in the prompt for context: extract entities `{name, type: person|org|product|concept|place}` and relations `{source, target, label}`. Normalize before insert: lowercase key, strip punctuation and org suffixes (inc/llc/corp/ltd) — display name keeps original casing, normalized key dedupes "OpenAI"/"Open AI"/"OpenAI Inc." to one node. Tables: `entities` (norm_key unique per user, display_name, type), `edges` (one table, `kind` column: entity–entity with label, document–entity mention; source chunk_id on both, FK CASCADE). On 429, sleep and retry the same batch (ponytail: no progress table; re-runs idempotent via norm_key dedupe).
   - *Where:* `backend/graphbuild.py`, triggered after stage-2 processing.
   - *Verify:* CLI run against the Baseten README locally prints extracted triples that are sane; then via UI, upload a doc and `SELECT count(*) FROM entities` grows.
   - *Fence:* no entity-embedding similarity merging (exact-name match only); no cross-user data ever.
2. **Graph API + viz.** `/api/graph` returns nodes+links JSON for the user. React page with react-force-graph-2d: color by entity type, node size by degree, click → side panel with entity name, connected nodes, and source chunk excerpts.
   - *Verify:* on the live URL, upload 3 docs, open Graph, drag nodes, click one, see its chunks. Screenshot-worthy = stage gate.
   - *Fence:* 2D only (no 3D/VR mode); cap render at 500 nodes with a "top by degree" filter, don't paginate-perfect it.

### Stage 4 — Chat with citations (one session)

**Goal:** ask a question, get an answer with [1][2] citations; each citation links to the source chunk and highlights its graph node.

1. **Graph-powered retrieval + answer.** `/api/chat` retrieves through the graph, not just around it: (a) match question terms against `entities.norm_key`, (b) traverse 1 hop to connected entities, (c) collect chunks cited by those edges, (d) union with FTS top-8, dedupe → Groq with the entity-relation triples AND chunks in context, prompt forces `[n]` citation markers → response `{answer, citations: [{chunk_id, document, page_no, excerpt, entity_ids}], graph_path}`. The answer can say *why* via relationships, and the UI can show the path.
   - *Verify:* `curl` a question whose answer spans two documents connected only through a shared entity → answer uses both and cites both. (This is the test FTS-alone fails.)
   - *Fence:* 1 hop only, no conversation memory beyond last 6 messages, no streaming in v1, no reranker, no hybrid/embeddings.
2. **Chat UI.** Chat page; citations render as numbered pills; click → opens document preview at that chunk, "show in graph" jumps to Graph page with the entity highlighted.
   - *Verify:* live URL: ask "what is X?" about your own uploaded doc, click citation [1], see the exact source paragraph. **This is the demo moment — record it.**
   - *Fence:* no chat history persistence page, no multi-graph switching.

### Stage 5 — S3 connector (one session; blocked on Arnav creating an AWS account)

Connect-your-bucket form (access key, secret, bucket, prefix) → credentials encrypted at rest → "Sync" lists objects, ingests supported types through the exact stage-2 pipeline.
- *Verify:* put 3 files in a test bucket, click Sync, they appear as processed documents and the graph grows.
- *Fence:* read-only access, no continuous sync/webhooks — manual sync button only.

### Stage 6 — Google Drive connector (one session; blocked on GCloud project + OAuth consent setup — this approval loop can take days, start the console setup early if Drive matters)

OAuth (drive.readonly), token stored encrypted, folder picker, same manual Sync into the stage-2 pipeline. Sync compares Drive `modifiedTime` + sha256 so only new/changed files are re-indexed.
- *Verify:* connect a real Drive folder, sync, chat cites a Drive doc.
- *Fence:* stays in Google's "testing" mode (100 users) — no verification review for MVP.

### Stage 7 — Hardening (only when strangers are about to use it — not before)

Security sweep (`/security-sweep`), login rate limiting, Groq spend guard (per-user daily call cap — free key is shared with Arnav's other projects), landing page copy.
- *Verify:* security sweep report clean of criticals; 11 MB file and .exe both rejected with clear errors.
- *Cut from this stage (add on real evidence, not anticipation):* magic-byte file sniffing (extension check + extractor failure already rejects junk), per-user API rate limits (no users yet).

## Risks and tripwires

1. **Groq free-tier rate limits throttle graph building** (biggest risk — extraction is ~1 call/chunk). *Tripwire:* felt at stage 3 step 1 CLI test, not later. *Fallback:* batch multiple chunks per call, drop to llama-3.1-8b-instant for extraction, and keep co-occurrence edges as the degraded mode.
2. **Render free tier: cold starts (~50 s after idle) and 512 MB RAM.** *Tripwire:* stage 0 gate feels it immediately. *Fallback:* accept cold starts for MVP (note on landing page); keep deps light (no torch/spacy — this is also why FTS-not-embeddings).
3. **Neon free tier auto-suspends compute.** *Tripwire:* `/api/health` slow first-hit at stage 0. *Fallback:* fine for MVP; connection retry with backoff in the DB layer from day 1.
4. **LLM extraction quality on messy real docs** (tables, scans, slides). *Tripwire:* stage 3 verify on a real PDF, not just markdown. *Fallback:* graph quality degrades gracefully to document–entity mentions only; be honest in the UI about "failed" docs.
5. **Fernet key loss = all customer data unreadable.** *Tripwire:* none — prevent: `ENCRYPTION_KEY` backed up in a password manager the day it's generated (step 0.2 checklist item).

## Upgrade path (explicitly NOT the MVP)

Hybrid retrieval (pgvector + local embeddings + BM25 + reranker) · streaming chat · entity merging via embeddings · KMS-managed keys · teams, roles & per-document permissions (required before real enterprise sales) · graph summarization levels for 100k+ node graphs · conversation memory · Celery/Redis job queue (when BackgroundTask chokes on real volume) · continuous connector sync · billing.

Full architecture review with scores that drove the 2026-07-10 amendments: graph-in-retrieval was the decisive change; permissions and hybrid search are the first two items to promote when real users appear.
