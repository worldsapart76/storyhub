# CLAUDE.md — StoryHub

StoryHub is a personal-use library manager and discovery layer for AO3 fan
fiction. Calibre stays the source of truth; StoryHub adds a browser-
extension capture layer, a Railway cloud hub for queues + snapshots,
Cloudflare R2 for epub delivery, and a PWA dashboard accessible from any
device. Replaces an earlier tkinter-based orchestrator (FanFictionFlow,
archived on disk at `c:\Dev\FanFictionFlow` and not running).

This file is read at the start of every Claude Code session. Keep it tight;
detail lives in `docs/`.

## High-level architecture

Capture flows: browser extension on AO3 → Railway queue → local worker
(Windows tray app) → Calibre Content Server REST → snapshot SQLite to R2.
Status flows: any client → Railway status-update queue → worker → Calibre
+ optional AO3 sync action. PWA dashboard reads snapshot from R2, runs
filtering client-side in IndexedDB.

Full diagram: ARCHITECTURE.md and docs/architecture.md.

## Components

- `worker/` — Python (3.12) Windows tray service; drives Calibre + R2 + FanFicFare + X4. See docs/components/worker.md.
- `extension/` — browser extension (Chromium + Firefox); AO3 capture, badges, status hooks. See docs/components/extension.md.
- `railway/` — cloud hub: `/api/*` endpoints + Postgres + dashboard host. See docs/components/railway-service.md.
- `pwa/` — dashboard Progressive Web App. See docs/ux/*.md.
- `bookmarklet/` — single-file mobile capture fallback. See docs/components/extension.md (§4.2).

## Where to find details

- System architecture: docs/architecture.md
- Data model (Calibre columns, Railway tables, snapshot format): docs/data-model.md
- Authentication: docs/auth.md
- UX details by surface: docs/ux/*.md (load only what's relevant)
- Component specs: docs/components/*.md
- Lifted FFF logic (do not change without reading): docs/lifted-from-fff/*.md
- Build phases: docs/build-phases.md
- Open questions and parking lot: docs/open-questions.md
- Collaboration notes (preferences, decision rationale, pitfalls): docs/collaboration-notes.md

## Build status

Phase 0 (user-side infra: Calibre server, columns, R2 bucket, Railway
project + Postgres + env vars, auth token) is done. The repo is at the
scaffold stage — docs + skeleton, no code yet. Next code work begins at
Phase 1 (Railway hub + R2 + worker shell). See docs/build-phases.md.

## Pause and investigate when context is missing

If you encounter code without rationale, or documentation that references
code that doesn't exist (or behaves differently than described), STOP.
The most likely cause is that something was missed during the FFF →
StoryHub migration, or a doc/code update only landed on one side.

Trigger examples:
- Code references a config value or constant with no doc explaining its purpose
- Doc describes a behavior that no code implements
- Function or pattern with no rationale for its specific shape
- A defensive guard, magic number, or "confirmed behaviour" note with no "why" anywhere
- A mention of "old FFF" behavior without explanation of the StoryHub equivalent
- A reference to a file path, table name, or endpoint that doesn't exist

What to do:
1. Surface the gap explicitly to the user before writing code around it
2. Search the FFF repo (archived on disk at `c:\Dev\FanFictionFlow`) for the missing context
3. Check git history of relevant files
4. Ask the user if 1–3 don't resolve it

Do NOT write code that works around the missing piece without flagging it.
The missing context might be load-bearing.

## Hard rules — DO NOT change without explicit instruction

- DO NOT use `calibredb` CLI — REST API via Calibre Content Server only
- DO NOT bypass the Review Queue when writing `#ao3_work_id` / `#collection` / `#primaryship` metadata
- DO NOT use FanFicFare for first-fetch — that's the extension's job. FanFicFare is for chapter-update detection on already-imported stories only.
- DO NOT sync `"Unread"` from any source — it's the device default, not a deliberate state
- DO NOT change the XTEINK folder structure or filename format — Crosspoint indexes by content hash; structure changes orphan caches. See docs/lifted-from-fff/xteink-transfer.md.
- DO NOT change tag categories after the user has clicked "Lock category list" without a code change
- DO NOT change Calibre column types/names without checking docs/lifted-from-fff/calibre-quirks.md
- DO NOT use Calibre's built-in `rating` column for AO3 rating — `rating` is a 1–5 star integer. AO3 rating is in `#maturity` (text).
- DO NOT support platforms other than Windows for the worker
- DO NOT use tkinter or any native GUI framework — PWA only
- DO NOT skip cover-image square cropping (200×200) for Reading Lists. See docs/ux/reading-lists.md.
- DO NOT distinguish AO3 bookmarks by the "Recommend" checkbox — any bookmark = Favorite
- DO NOT silently truncate when imposing limits — log what was dropped. (No silent caps principle from FFF.)
- DO NOT treat Phase 7 auto-classifier output as authoritative — those tags are flagged `auto_classified` and need user review before "Lock category list"
- DO NOT write `#readstatus` to a book that already had a status (preserved from FFF — only fresh imports get `#readstatus`)
- DO NOT change the snapshot format without bumping `snapshot_versions.version` — clients depend on the version for cache invalidation

## Environment

- OS: Windows (worker only). Extension / PWA / bookmarklet are cross-platform per their distribution surfaces.
- Python: 3.12 for the worker
- Calibre Content Server: localhost:8080 (also LAN at 192.168.4.158:8080), no auth (LAN-only)
- Calibre library: `FanFiction` (default library; the other, `Calibre-Commercial`, is untouched)
- Cloudflare R2: bucket `storyhub`, separate from CollectCore's
- Railway: project `StoryHub` (separate from CollectCore), service `storyhub-api`, Postgres provisioned

## Session state

- Worker runtime files: `~/.storyhub/` (settings.json, worker.log, etc.)
- PWA: IndexedDB + CacheStorage on each device
- Extension: extension storage API + IndexedDB for snapshot cache

## Collaboration notes

- Step-by-step over all-at-once for multi-step processes; wait for confirmation between chunks.
- Lay out 2–4 options with tradeoffs and a clear recommendation when there's a decision.
- Compact UI labels (e.g. "OR / AND", not "Include any / Include all") — single user, screen space matters.
- Take pushback seriously and revise; don't defend the original answer.
