# railway/

The cloud hub service: `/api/*` endpoints, Postgres for all queue/state, and
the dashboard PWA host. Deployed to the Railway `storyhub-api` service.

Framework: **FastAPI** (decided 2026-06-14) — see
[../docs/components/railway-service.md](../docs/components/railway-service.md).

Schema + endpoint authority: **[../docs/calibre-removal-redesign.md](../docs/calibre-removal-redesign.md)**
§6 (data model) + §12 (operational). (data-model.md / railway-service.md are the
superseded Calibre-era spec.)

## Layout (Phase A — redesign schema)

```
app/
  main.py            FastAPI app, lifespan (Postgres pool), router wiring, /health
  config.py          env settings (AUTH_TOKEN, DATABASE_URL, R2_*)
  auth.py            Bearer-token dependency applied to every /api route
  db.py              asyncpg pool + json codec + schema bootstrap
  schema.sql         redesign §6/§12 tables (idempotent forward CREATEs)
  models.py          Pydantic v2 request/response models + enums
  routers/           one module per endpoint group
migrations/
  0001_reset_to_redesign.sql   one-time teardown of the Calibre-era tables
```

works, tags, groups have read+write endpoints; queue, ao3-actions, snapshot,
worker are reshaped to the redesign schema. reading-lists and saved-filters
routes exist but return `501` until Phase F (their tables are already created).

**First-boot on the live DB:** apply `migrations/0001_reset_to_redesign.sql`
once (clean-rebuild decision, 2026-06-15) before the redesign `schema.sql` runs.
During development, wipe-and-recreate freely — the library reloads from Calibre.

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
