# GraphMind

- PLAN.md is the source of truth: stack decisions, stages, fences. Read it before doing anything; update it when a stage completes.
- Ponytail discipline applies: dependency budget is written in PLAN.md — no new deps without a reason added there.
- Local dev: `.venv/Scripts/python -m uvicorn backend.main:app --port 8765` (8000 is taken by something else on this machine); frontend `npm run dev` in `frontend/` proxies /api to 8000 — change the proxy target to 8765 if using dev mode.
- 2026-07-10: Stage 0 scaffold verified locally and pushed. Deploy blocked on Arnav creating Neon + Render free accounts.
