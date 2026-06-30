# extension/

Browser extension (single codebase, Manifest V3) for Chromium (Chrome/Edge/
Brave, desktop) first; Firefox (desktop + Android) in a later pass. AO3 real-time
capture, three-state badges, status hooks, `ao3_actions` drain, and one-time
backfill/catch-up commands.

Spec: [../docs/components/extension.md](../docs/components/extension.md) +
redesign §12.1–12.2. Plain JS, no build step — installed unpacked in developer
mode (no store submission).

## Architecture

- **`background.js`** — classic service worker. `importScripts`'s the vendored
  sql.js UMD bundle + the libs, owns snapshot sync (on install / startup / hourly
  alarm), answers options-page messages. Classic (not a module worker) so sql.js
  loads cleanly.
- **`lib/`** — shared, namespaced under `globalThis.SH`, loaded by the SW
  (`importScripts`), the options page (`<script>`), and content scripts
  (manifest `js[]`):
  - `storage.js` — `chrome.storage.local`: hub config, badge map, snapshot meta.
  - `api.js` — Railway hub client (single bearer token; `validate()` for setup).
  - `snapshot.js` — SW-only; projects the snapshot SQLite (`work_cards`) into a
    compact badge map `work_id → {s:status, f:fav, a:availability}`. Content
    scripts read that map with no network and no WASM.
- **`options.html` / `.js` / `.css`** — first-run setup (hub URL + token,
  validate, sync) and snapshot status.
- **`vendor/`** — `sql-wasm.js` + `sql-wasm.wasm` (copied from `pwa`'s sql.js).

## Install (unpacked, Chromium)

1. `chrome://extensions` → enable **Developer mode** → **Load unpacked** →
   select this `extension/` folder.
2. Click the toolbar icon (or right-click → Options) → enter the hub URL
   (`https://ffstoryhub.up.railway.app`) and the bearer token →
   **Validate & Save**. A successful validate triggers the first snapshot sync.

## Phase-E build status

- **E1 — scaffold + setup + snapshot cache: DONE.** Manifest, options/setup,
  background sync, badge-map projection.
- **E2 — badges on AO3 listings: DONE.** `content/badges.js` + `.css`: for every
  work blurb (search / MfL / bookmarks / history / tag / series / author),
  injects N/A (outlined) vs Unread/Read/DNF + ★, read from the cached badge map.
- **E3a — work-page capture + status hooks: DONE.** `content/work.js` + `.css`,
  `lib/ao3.js` (scrape + same-origin AO3 actions), `lib/badge.js` (shared badge).
  Hooks Mark-for-Later → capture (scrape + epub → `/api/queue`), Mark-as-Read →
  Read, injects DNF → capture-if-needed + DNF + AO3 mark-read; status badge on the
  work title. Epub fetched in-page (session cookie); the SW does the hub POSTs +
  R2 PUT (R2 host added to host_permissions so the PUT is CORS-exempt). Native
  rails-ujs click intercepted (preventDefault) so capture isn't aborted by nav.
- **Pending-queue redesign (SUPERSEDES the E4 auto-drain): in progress.** Nothing
  is performed on click — every AO3 action (`content/work.js`) creates a unified
  `pending_changes` item via `POST /api/pending` (origin `ao3`) and toasts "Queued:
  …"; no instant AO3 change, no badge change. The on-AO3 **drawer**
  (`content/drawer.js`, all AO3 pages) lists the queue and **Apply to AO3** performs
  each item's side-effect from the page session, then acks (`/api/pending/{id}/ack-ao3`).
  `content/drain.js` is **removed** — do not re-add a background drain. **AO3's mark
  routes are Rails `button_to` forms — `lib/ao3.js` `action()` must POST
  `_method=patch` + `authenticity_token` in the body; a raw HTTP `PATCH` is rejected
  (Rails nulls the session → AO3 "you don't have permission…"). Do NOT revert to a
  bare PATCH.** (Captures still use the old commit flow until the next chunk folds
  them into the queue with epub staging + Review Queue.)
- **Debounced snapshot rebuild: DONE.** After a capture / work-page status change
  the content script signals the SW, which (re)sets a 1-min alarm and rebuilds the
  snapshot once the burst settles — so adding many works across tabs triggers a
  single rebuild, and new works reach the PWA without a manual step. The PWA's
  in-app rebuild remains as a manual override.
- E3b / bookmark — Bookmark intercept → private bookmark = Favorite (work-page
  intercept + drain `bookmark`/`remove_bookmark` + PWA favorite enqueue). *next*

## Capture epub fetch (why it's shaped this way)

AO3's Cloudflare blocks the epub fetch from the extension **service worker** (403
— Chrome TLS/HTTP2 fingerprint + `chrome-extension://` origin) and from **Railway**
(525 — datacenter IP). Only a **page-context content-script fetch** passes (your
residential IP + real session). That fetch is otherwise CORS-blocked on
`download.archiveofourown.org` (no ACAO header), so `rules.json` (declarativeNet-
Request) injects `Access-Control-Allow-Origin`. The content script then POSTs the
bytes to Railway (`/api/queue/{id}/epub`) — it can't PUT to R2 directly (R2 has no
browser CORS). Do not "simplify" this back to an SW or server-side fetch — both
are blocked.
- E3 — work-page capture + status hooks (Mark-for-Later, Mark-as-Read, DNF,
  bookmark intercept).
- E4 — `ao3_actions` drain on page load. *(precursor: confirm the live DB's
  `ao3_actions` CHECK includes `mark_for_later` — it's in schema.sql.)*
- E5 — one-time backfill/catch-up commands (MfL catch-up, 61 failed/mystery
  re-scrape, History + structural backfill).
