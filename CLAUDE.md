# GraphMind

- PLAN.md is the source of truth: stack decisions, stages, fences. Read it before doing anything; update it when a stage completes.
- Ponytail discipline applies: dependency budget is written in PLAN.md — no new deps without a reason added there.
- Local dev: `.venv/Scripts/python -m uvicorn backend.main:app --port 8765` (8000 is taken by something else on this machine); frontend `npm run dev` in `frontend/` proxies /api to 8000 — change the proxy target to 8765 if using dev mode.
- 2026-07-10: Stage 0 scaffold verified locally and pushed. Deploy blocked on Arnav creating Neon + Render free accounts.
- 2026-07-12 gotcha: bulk uploads once stampeded Groq's rate limit (282/411 failed) and a duplicated retry script clobbered its twin's chunks. Fixes that must stay: process-wide `_groq_lock` serializing extraction calls (graphbuild.py), and the atomic status claim in `process_document` (only `status='uploaded'` docs are claimable — a second worker matches 0 rows and exits).
- 2026-07-12: extraction now tries Groq first, falls over to Gemini (gemini-flash-latest, GEMINI_API_KEY) on rate-limit — see `_call_llm` in graphbuild.py. Needed because one free Groq tier can't absorb a 400+ doc bulk upload.
