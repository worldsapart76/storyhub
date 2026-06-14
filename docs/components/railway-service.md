# Railway service

> Source: §4.3 of the original StoryHub design doc.

[DECIDED on shape, OPEN on framework]

Hosted on Railway, exposed via `*.railway.app` subdomain. Single Postgres
database for all queue/state. Also hosts the dashboard PWA shell + static
assets.

## Endpoint surface

| Endpoint | Purpose |
|---|---|
| `POST /api/queue` | Extension/bookmarklet adds a story |
| `GET  /api/queue?status=pending` | Worker drains pending items |
| `POST /api/queue/{id}/ack` | Worker marks item processed |
| `POST /api/status-updates` | Status change from dashboard or extension hooks |
| `GET  /api/status-updates?status=pending` | Worker pulls pending updates |
| `POST /api/status-updates/{id}/ack` | Worker acks |
| `GET  /api/snapshot/current` | Returns version + R2 URL of current snapshot |
| `POST /api/snapshot/bump` | Worker tells Railway a new snapshot exists in R2 |
| `POST /api/worker/heartbeat` | Worker liveness ping (~30s) |
| `GET  /api/worker/status` | Dashboard reads worker liveness for status badge |
| `POST /api/ao3-actions` | Worker enqueues AO3 actions (bookmark/mark-read) |
| `GET  /api/ao3-actions?status=pending` | Extension pulls pending |
| `POST /api/ao3-actions/{id}/ack` | Extension confirms completion |
| `GET/POST/PUT/DELETE /api/reading-lists/...` | Reading List CRUD (incl. Saved Filters under `/api/saved-filters/...`) |
| Dashboard routes | PWA shell + static assets |

Every endpoint requires `Authorization: Bearer {token}`. See [../auth.md](../auth.md).

Database tables: see [../data-model.md §6.3](../data-model.md).

## [OPEN] Framework choice

Likely FastAPI (Python — same language as the worker, reuse models) or a Node
service. **Not decided at scaffold stage** (this repo is docs-only so far);
decide during Phase 1. Tradeoff: FastAPI shares language + models with the
worker; Node aligns better with the PWA ecosystem. Tracked in
[../open-questions.md](../open-questions.md).

## Provisioning status (Phase 0, done)

- Project `StoryHub` (separate from CollectCore)
- Postgres service provisioned
- Empty service `storyhub-api` with a public `*.up.railway.app` domain
- Env vars set: `AUTH_TOKEN`, `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL`, `DATABASE_URL` (reference-linked to Postgres)
- No code deployed yet — Phase 1 creates the service code, hooks up GitHub deployment, and pushes

> The exact public URL is saved in the user's credential storage — always ask;
> do not assume `storyhub.up.railway.app`.
