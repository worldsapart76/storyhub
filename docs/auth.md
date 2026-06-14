# Authentication

> Source: §8 of the original StoryHub design doc.

Single user, single token model:

- Token generated once during initial Railway setup, copy-paste into:
  - Extension settings
  - Bookmarklet (embedded in the JS snippet)
  - Local worker config
  - Dashboard PWA on first visit (stored in IndexedDB)
- All endpoints require `Authorization: Bearer {token}` header
- Token never expires unless rotated manually
- Rotation procedure: generate new token in Railway, update all clients
- No multi-user, no OAuth, no login screens

This is fine because:
- Railway URL is a personal `*.railway.app` subdomain, not advertised
- Token is a long random string
- Worst case if leaked: someone fills your queue with garbage; you rotate token, drain queue manually

## Provisioning status (Phase 0, done)

- Token generated via `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- Stored in the user's credential storage AND set as the `AUTH_TOKEN` env var on the Railway `storyhub-api` service
- Single shared secret for all clients (extension, worker, dashboard, bookmarklet)

## Calibre auth

The Calibre Content Server stays bound to the local network only and has **no
auth** — LAN-only is the security model. No StoryHub flow requires Calibre to
be publicly exposed (worker is local, snapshot lives on R2, Railway never
connects back to Calibre). If exposure ever becomes a need, turn on Calibre's
username/password and update the worker config. See
[components/calibre-server.md](components/calibre-server.md).
