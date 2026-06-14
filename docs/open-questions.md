# Open questions and parking lot

> Source: §12 of the original StoryHub design doc, plus the §11 lift tables
> (kept here so the migration plan survives in the new repo).

## Decisions deferred to implementation time (not blocking)

- ~~**Framework choice for Railway service (§4.3):**~~ **DECIDED 2026-06-14: FastAPI** (Python — shares Pydantic models with the worker; the PWA is static assets FastAPI serves, so no Node-ecosystem gain). See [components/railway-service.md](components/railway-service.md).
- ~~**PWA framework:**~~ **DECIDED 2026-06-14: React + Vite** (largest ecosystem + most reliable AI-assisted dev; React's heavier runtime is offset by list virtualization + bundle discipline to hit the Palma <2s cold-start target). See [ux/pwa-shell.md §7.1](ux/pwa-shell.md).
- **Worker concurrency:** How many queue items processed in parallel? Likely 1–3. Tune during Phase 1.
- **Auto-classifier LLM choice:** Likely Haiku 4.5 (cheap, fast, good at classification). Decide during Phase 7.
- **Cover image hosting:** R2 under `/covers/{list_id}.jpg`. Trivial; lock at Phase 6.
- **Push notification delivery (§5.4):** If/when stale-queue alerts become a real annoyance, choose between email, browser push, Pushover, etc. Dashboard banner is the no-cost default and may be enough.
- **Backup / disaster recovery procedure:** Calibre is the recoverable source of truth. Document the "rebuild from scratch" steps during Phase 9.

## Deferred to post-v1 (already decided)

- **In-browser reader with cross-device position sync (§7.4)** — v2 candidate. See [v2-deferred/in-browser-reader.md](v2-deferred/in-browser-reader.md).
- **Smart Reading Lists (general user-defined rules, §7.7)** — v2 candidate; built-in Favorites smart list is the only v1 instance.
- **AI taste model** — v2+ candidate; separate design pass after analytics is in use.
- **Stats / analytics view (§7.8)** — entire surface deferred to v2; data accumulates from v1 launch. See [v2-deferred/stats-analytics.md](v2-deferred/stats-analytics.md).
- **Reading session tracking** — out of scope unless explicitly added.
- **Manual epub upload, listing-card "Add" buttons, series/author bulk capture, cross-tab sync** — all v2 candidates (Phase 10).

## Migration: code to lift verbatim from FFF (Phase 2)

The lift happens in Phase 2 (worker integration), not at scaffold. FFF lives
archived at `c:\Dev\FanFictionFlow`.

| FFF source file | Goes to | Why |
|---|---|---|
| `normalize/ship.py` | `worker/normalize/ship.py` | Ship Rules 1–5 are battle-tested |
| `normalize/rules.py` | `worker/normalize/rules.py` | Collection keyword matching, user-curated |
| `sync/ao3.py` | `worker/sync/fanficfare.py` (renamed) | FanFicFare wrapper — chapter-update detection on existing stories only |
| `export/xteink_transfer.py` | `worker/export/xteink_transfer.py` | SD card folder tree, sanitization, skip/prune |
| `export/xteink_catalog.py` | `worker/export/xteink_catalog.py` | Multi-file catalog EPUB generation with adaptive splitting |
| `tags_audit.tsv` | `worker/data/tags_audit_seed.tsv` | Initial Favorite/Excluded seed; consumed on first launch then archived |

Rationale and behavior for each lifted module is preserved under
[lifted-from-fff/](lifted-from-fff/).

## Code that dies (not migrated)

- `sync/diff.py` — replaced by real-time queue, no batch CSV diff needed
- `sync/readstatus.py` — replaced by Railway status updates
- `export/boox_transfer.py` — replaced by R2 epub delivery
- `export/library_csv.py` — replaced by snapshot SQLite to R2
- `main.py` tkinter UI — replaced by PWA
- All "Phase 2 Browser Opener" code — replaced by extension inline banners
- `credentials.py` — no longer needed (extension uses user's logged-in session; FanFicFare login wall isn't fought)
