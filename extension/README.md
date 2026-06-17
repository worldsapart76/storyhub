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
- E2 — badges on AO3 listings (content script). *next*
- E3 — work-page capture + status hooks (Mark-for-Later, Mark-as-Read, DNF,
  bookmark intercept).
- E4 — `ao3_actions` drain on page load. *(precursor: confirm the live DB's
  `ao3_actions` CHECK includes `mark_for_later` — it's in schema.sql.)*
- E5 — one-time backfill/catch-up commands (MfL catch-up, 61 failed/mystery
  re-scrape, History + structural backfill).
