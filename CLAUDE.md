# CLAUDE.md — StoryHub

StoryHub is a personal-use library manager and discovery layer for AO3 fan
fiction. **Railway Postgres is the single source of truth**; StoryHub adds a
browser-extension capture layer, a Railway cloud hub (API + Postgres +
server-side normalization + snapshot builder), Cloudflare R2 for epub + snapshot
delivery, a thin Windows worker (X4 transfer + backup pull only), and a PWA
dashboard accessible from any device. Replaces an earlier tkinter-based
orchestrator (FanFictionFlow, archived on disk at `c:\Dev\FanFictionFlow` and
not running).

> **Forward design = `docs/calibre-removal-redesign.md` (ADOPTED 2026-06-14).**
> It removes Calibre entirely and is the authority for all new work. On any
> conflict with a Calibre-era doc, **the redesign wins.** Calibre-era docs still
> describe the system being replaced — keep them until migration (§10) is moving,
> then retire.

This file is read at the start of every Claude Code session. Keep it tight;
detail lives in `docs/`.

## High-level architecture

Capture flow: extension hooks AO3 "Mark for Later" → raw metadata + epub →
Railway `/api/queue` → server-side normalization → auto-commit or per-work
Review Queue (primaries only) → Postgres + epub to R2 → snapshot rebuilt.
Status flow: any client writes `read_status` / `is_favorite` directly to Railway;
AO3 side-effects (mark-read, private bookmark) queue in `ao3_actions`, drained by
the **extension** on its next AO3 visit (never the worker). PWA reads the R2
snapshot and filters client-side in IndexedDB.

Full operational spec: docs/calibre-removal-redesign.md §12. (ARCHITECTURE.md /
docs/architecture.md describe the superseded Calibre-era topology.)

## Components

- `worker/` — Python (3.12) Windows tray service; **thin agent**: X4/XTEINK SD-card transfer + local backup pull only (polls `pc_jobs`). No Calibre, no FanFicFare. See redesign §12.4–12.5.
- `extension/` — browser extension (Chromium + Firefox); AO3 capture (Mark-for-Later hook), badges, status hooks, `ao3_actions` drain. See docs/components/extension.md + redesign §12.1–12.2.
- `railway/` — cloud hub & **source of truth**: `/api/*` + Postgres + server-side normalization + snapshot builder. See redesign §12.1–12.3, docs/components/railway-service.md.
- `pwa/` — dashboard Progressive Web App. See docs/ux/*.md.
- `bookmarklet/` — single-file mobile capture fallback. See docs/components/extension.md (§4.2).

## Where to find details

- **AUTHORITATIVE design + operational spec + build plan: docs/calibre-removal-redesign.md** (data model §2–11, operational design §12, build sequence §13)
- Lifted FFF logic — XTEINK transfer/catalog, normalization rules (now seeding heuristics, redesign §6.3.1); still valid, do not change without reading: docs/lifted-from-fff/*.md
- UX details by surface: docs/ux/*.md (load only what's relevant; tag/Browse specifics are updated by redesign §6.3.1 / §12.6)
- Collaboration notes (preferences, decision rationale, pitfalls): docs/collaboration-notes.md
- **SUPERSEDED** (describe the Calibre-era system being replaced — historical until migration done): docs/architecture.md, docs/data-model.md, docs/auth.md, docs/components/*.md, docs/build-phases.md, docs/open-questions.md

## Build status

Phase 0 (user-side infra) and Phase 1 (Railway hub + worker shell) were built on
the **Calibre-era** plan. The project has since **adopted the Calibre-removal
redesign**. Calibre-coupled code is now discarded (`worker/calibre.py`, the
Calibre/FFF config); the Railway infra (auth, pool, router pattern) is reused.
New work follows the **re-sequenced build plan in redesign §13**, starting at the
new Postgres schema.

**Phase P (UI design & prototyping) — COMPLETE & SIGNED OFF 2026-06-15.** The
**unwired** React+Vite+TS design prototype in `pwa/` (mock data only — no API, no
real epubs) is the agreed design and becomes the Phase F scaffold. All surfaces
built & reviewed: design tokens + component kit, Browse + filter panel, story card
+ in-app reader, Review Queue, Tag Management, Reading Lists, Saved Filters, Sync
view, and the Extension on-AO3 injected controls. A full live click-through QA was
**deliberately deferred to Phase F wiring** (review against real data, not mock).
Locked design decisions + per-surface notes + run instructions:
`docs/phase-p-prototype.md`.

**Next:** the sign-off gate is cleared, so Phases E/F/G are unblocked. Per redesign
§13, build the backend (Phase A schema → B–D) and **Phase F** = wire this prototype
(add `vite-plugin-pwa`, `@tanstack/react-virtual` list virtualization, real
snapshot→IndexedDB, optimistic writes→Railway; replace `pwa/src/mock/data.ts` with
the §12.3 snapshot projection — component prop shapes already mirror it).

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

- DO NOT reintroduce Calibre into the pipeline — Railway Postgres is the source of truth. Calibre is a read-only break-glass inspector + one-time migration source only (if ever queried, REST not `calibredb`).
- DO NOT use FanFicFare — removed entirely (no first-fetch, no update detection; only complete works are ever added).
- DO NOT bypass the per-work Review Queue when assigning the **primary ship / primary collection** roles. Tag grouping/synonym/category curation lives in Tag Management, never the Review Queue. (redesign §12.1, §12.6)
- DO NOT let import/sync **clobber** a deliberate `Read`/`DNF`/`Favorite` back to `"Unread"` — Unread is the fresh-import default, applied only to fresh imports. (Amended 2026-06-16: Unread MAY be set as a *deliberate* app/extension correction, which enqueues a `mark_for_later` AO3 action — AO3's Read↔Mark-for-Later toggle. See redesign §12.2.)
- DO guard the **story** un-favorite (★ on a story) with a confirm — it removes the AO3 bookmark (the only AO3-destructive app action). Reading-list / saved-filter / tag stars are app-only and need no guard.
- DO NOT change the XTEINK folder structure or filename format — Crosspoint indexes by content hash; structure changes orphan caches. See docs/lifted-from-fff/xteink-transfer.md, redesign §12.5.
- DO NOT change tag categories after "Lock category list" without a code change (the `categories` table; redesign §12.6).
- DO NOT depart from the adopted schema (redesign §6, §12) without flagging it — that schema, not Calibre's columns, is the source of truth.
- AO3 rating lives in the `rating` enum (Explicit | Mature | Teen | General | Not Rated) — NOT a 1–5 star value, and no longer named `#maturity`.
- DO NOT support platforms other than Windows for the worker.
- DO NOT use tkinter or any native GUI framework — PWA only.
- DO NOT skip cover-image square cropping (200×200) for Reading-List covers (the only place the crop applies — not book covers). See docs/ux/reading-lists.md, redesign §6.4.
- DO NOT distinguish AO3 bookmarks by the "Recommend" checkbox — any bookmark = Favorite (`is_favorite=true`). Bookmarks StoryHub creates on AO3 are always **private**. (redesign §12.2)
- DO NOT silently truncate when imposing limits — log what was dropped. (No silent caps.)
- DO NOT treat auto-classifier output as authoritative — tags are flagged `auto_classified` and need user review before "Lock category list".
- DO NOT overwrite an existing `read_status` — only fresh imports get a default (Unread). Now a Railway-side rule, not the worker.
- DO NOT change the snapshot format without bumping the version (`snapshot_versions.version` for content, the format version for structure) — clients depend on it for cache invalidation. (redesign §12.3)

## Environment

- OS: Windows (worker only). Extension / PWA / bookmarklet are cross-platform per their distribution surfaces.
- Python: 3.12 for the worker
- Calibre: **out of the runtime pipeline.** Kept only as the one-time migration source and a read-only break-glass inspector (library `FanFiction`, localhost:8080 / LAN 192.168.4.158:8080). Never written.
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
