# railway/

The cloud hub service: `/api/*` endpoints, Postgres for all queue/state, and
the dashboard PWA host. Deployed to the Railway `storyhub-api` service.

Framework: **FastAPI** (decided 2026-06-14) — see
[../docs/components/railway-service.md](../docs/components/railway-service.md).

Spec: [../docs/components/railway-service.md](../docs/components/railway-service.md).
Endpoint surface and tables: that doc + [../docs/data-model.md](../docs/data-model.md).

## Layout (Phase 1)

```
app/
  main.py            FastAPI app, lifespan (Postgres pool), router wiring, /health
  config.py          env settings (AUTH_TOKEN, DATABASE_URL, R2_*)
  auth.py            Bearer-token dependency applied to every /api route
  db.py              asyncpg pool + json codec + schema bootstrap
  schema.sql         all tables from data-model §6.3 (idempotent)
  models.py          Pydantic v2 request/response models + enums
  routers/           one module per endpoint group
```

queue, status-updates, ao3-actions, snapshot, worker have full Phase-1
implementations. reading-lists and saved-filters routes exist but return
`501` until Phase 6 (their tables are already created).

## Running locally

Requires Postgres reachable at `DATABASE_URL`.

```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
AUTH_TOKEN=... DATABASE_URL=postgres://... \
  .venv/Scripts/python -m uvicorn app.main:app --reload
```

The schema is applied automatically on startup (idempotent). `GET /health` is
unauthenticated; every `/api/*` route needs `Authorization: Bearer {AUTH_TOKEN}`.
Interactive docs at `/docs`.
