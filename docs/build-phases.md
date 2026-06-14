# Build phases

> Source: §10 of the original StoryHub design doc. Phases are in dependency
> order. Each concludes with a clear "what works after this" milestone so
> progress is testable end-to-end.

## Phase 0 — User-side setup [STATUS: done as of 2026-06-14]

Setup tasks the user does once outside of any code. No StoryHub code involved.

- ✅ Calibre Content Server enabled, listening on localhost:8080 (verified 2026-06-13)
- ✅ Custom columns added: `#date_read`, `#all_fandoms`, `#all_relationships`, `#all_characters`, `#maturity` (verified 2026-06-13)
- ✅ Cloudflare R2 bucket `storyhub` + S3-compatible credentials
- ✅ Railway project `StoryHub` + Postgres + empty `storyhub-api` service with public domain and 7 env vars set
- ✅ Auth token generated (256-bit) and set as `AUTH_TOKEN`

See [../STORYHUB_HANDOFF_NOTES reference] (kept in the FFF repo) for exact
provisioned values to ask the user for; do not assume them.

## Phase 1 — Foundation: Railway hub + R2 + worker shell

**What gets built:**
- Railway service (FastAPI or similar — choice deferred to scaffold time) exposing all `/api/*` endpoints
- Postgres schema set up with all tables from [data-model.md §6.3](data-model.md)
- Auth token middleware on every endpoint
- Cloudflare R2 bucket configured
- Local Python worker as Windows tray app (autostart on login). Initially does only: heartbeat to Railway every 30s, poll for queue items, ack them without doing anything

**What works after this:**
- POST to `/api/queue` accepts items, they sit in Railway's pending state
- Worker drains queue (no-ops), Railway view (CLI/curl-only) shows queue depth + worker heartbeat
- Solid foundation; nothing user-facing yet

## Phase 2 — Worker integration with Calibre + FFF code lift

**What gets built:**
- Worker speaks to Calibre Content Server REST API (no `calibredb` subprocess anywhere — REST end-to-end)
- Worker capabilities: pull queue items, fetch staged epub from R2, Calibre add via REST, run normalization (ship Rules 1–5, collection keyword matching), decide auto-resolved vs review-needed, schedule periodic FanFicFare update check, run X4 SD card transfer + catalog
- **Code lifted verbatim from old FFF** (see [lifted-from-fff/](lifted-from-fff/) and the lift table in [open-questions.md](open-questions.md) / repo §11):
  - `normalize/ship.py` (Rules 1–5)
  - `normalize/rules.py` (collection keyword matching)
  - `sync/ao3.py` → `worker/sync/fanficfare.py` (renamed)
  - `export/xteink_transfer.py`
  - `export/xteink_catalog.py`
- `tags_audit.tsv` imported as the initial Favorite/Excluded seed (lands in Phase 6's data)

**What works after this:**
- A queue item with metadata + epub → ends up in Calibre with `#ao3_work_id`, `#collection`, `#primaryship`, etc. populated
- Review queue accumulates un-auto-resolvable items, accessible via Railway directly
- X4 sync triggerable via a worker CLI command (no dashboard yet)

## Phase 3 — Extension v1 (desktop Chromium + Firefox)

**What gets built:**
- "Add to StoryHub" button on AO3 work pages
- Three-state badge (N/A vs colored read status) on work pages and listing cards
- Local snapshot cache in IndexedDB; version-poll on every AO3 page load
- Epub fetch via authenticated session; POST to `/api/queue`
- Auth token + Railway URL settings page
- Robust error handling

**What works after this:**
- Click "Add to StoryHub" → story imports to Calibre end-to-end
- Badge shows accurate status across AO3 pages
- **User could start using StoryHub for new stories at this point**, even without a dashboard

## Phase 4 — Status updates, snapshot push, R2 backfill, AO3 sync hooks

**What gets built:**
- Worker exports snapshot SQLite after every Calibre write; uploads to R2; bumps version
- One-time R2 backfill of all existing library epubs (~3.5 GB, paced)
- Status update endpoints + worker handling per the §5.3 source matrix
- Extension status-change hooks (MfL intercept, bookmark detection, DNF button)
- AO3 actions banner

**What works after this:**
- Status updates flow end-to-end from any source into Calibre
- Snapshot in R2 always fresh
- AO3 stays in sync via the banner mechanism
- **System is feature-complete on the capture side**, even without the dashboard

## Phase 5 — Dashboard PWA v1 (basic)

**What gets built:**
- PWA shell (service worker, IndexedDB, CacheStorage, install manifest)
- Auth token entry; snapshot download + cache
- Browse view, **always-visible surface only** (search, status chips, word-count slider, sort, starred-saved-filter chip row)
- Status change controls on every card
- Sync view (worker status, queue depth, activity, "Sync X4" button)
- Review Queue view
- Settings (basic): auth/Calibre/R2 creds, per-device open mode, device name

**What works after this:**
- Browse the library from any device; filter by status/wordcount/search; change statuses
- X4 sync from dashboard (no more CLI)
- **PWA is a usable daily-driver** for browsing/status management

## Phase 6 — Dashboard PWA v2 (full features)

**What gets built:**
- Tag Management UI (state, category, classifier toggle, "Lock category list")
- Category-box filter surface (three-tap chip model, per-box AND/OR)
- Saved Filters (create, save, apply, star → Browse chip)
- Reading Lists (manual + built-in Favorites + per-list auto-pin + per-story pin + cover upload)
- Cross-cutting workflows (snapshot-filter-to-list, add-filtered-to-list)
- Bulk actions
- Full Settings view

**What works after this:** full v1 feature set is live.

## Phase 7 — One-time backfill + catch-up commands

All in the extension's options page, all pause/resume capable:
- **AO3 History backfill** — populates `#date_read`
- **Structural metadata backfill** — populates `#all_*` and `#maturity` (~4 hours)
- **Marked-for-Later catch-up** — clears pre-launch backlog
- **Initial tag categorization pass** — pattern matching + Claude API fallback; flags all `auto_classified`

**What works after this:** historic data loaded; v1 is data-complete; user
reviews tags then clicks "Lock category list".

## Phase 8 — Mobile delivery

Independent of Phases 5–7; can ship as soon as PWA v1 is solid.
- Bookmarklet finalized + documented
- Firefox Android extension build
- PWA install testing on Palma (Add to Home Screen, offline, EPUB pinned-aware open)

## Phase 9 — Sunset

- Uninstall Read Status Badge + Tampermonkey MfL exporter from Chrome
- Uninstall CalibreFanFicBrowser on Palma
- Old FFF repo stays archived on disk untouched
- Document "rebuild from scratch" disaster-recovery procedure

## Phase 10 — v2 / Stretch goals [DEFERRED]

Stats/analytics ([v2-deferred/stats-analytics.md](v2-deferred/stats-analytics.md)),
in-browser reader ([v2-deferred/in-browser-reader.md](v2-deferred/in-browser-reader.md)),
AI taste model, smart Reading Lists, push notifications, manual epub upload,
per-card "Add" buttons, per-story open-mode override, series/author bulk
capture, cross-tab sync.

## Dependency summary

```
Phase 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 9
                              (8 mobile can start at 5)
Phase 10 (v2) is post-launch, no v1 dependency.
```

**Usable milestones:**
- After Phase 3: capture works (no dashboard yet)
- After Phase 5: dashboard PWA is daily-driver for browsing/status
- After Phase 6: full v1 feature set
- After Phase 7: historic data loaded, tags categorized, ready to lock
