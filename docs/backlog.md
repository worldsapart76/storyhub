# Backlog — future considerations (not scheduled)

Deferred ideas and "keep it on the radar" items that are **not** part of the active
build sequence (that lives in `calibre-removal-redesign.md` §13). Nothing here is
committed work — it's a parking lot to revisit. Add to the end as they come up.

## Storage / data
- **Delete epub files for DNFs.** Consider purging `epubs/{work_id}.epub` from R2
  when a work is marked DNF (you won't re-read it). Low priority — per-epub storage
  is small, so probably not worth the effort now; on the radar. (Added 2026-06-17.)
- **Incremental / delta snapshot sync.** §12.3 parks this; the full snapshot is
  ~33 MB now and clients re-download it per content-version bump. Revisit if full
  re-download starts to feel heavy. (Surfaced 2026-06-17 during Phase E.)
- **Snapshot-cache integrity guard.** The IndexedDB snapshot cache (`pwa/src/data/
  idb.ts` + `snapshot.ts`) reuses a cached copy whenever its stored `version` matches
  the server's current version, with **no integrity check** — so a truncated download
  or an old-format copy stored under the current version is reused forever and never
  re-fetched. After downloading, verify the bytes parse as SQLite and `work_cards`
  has a sane row count (and/or the expected `format_version`) before caching; refuse
  to cache (or force a re-download) otherwise. Workaround shipped 2026-06-29 (manual
  Settings → Library → Reload + an error-screen "Clear cache & reload"), but those are
  user-initiated; this would make it automatic. (Surfaced 2026-06-29 while chasing a
  "desktop shows 8 works" report — that turned out to be a stuck search query, but the
  same investigation exposed this latent fragility.)

## Capture / sync
- **Server-side duplicate-capture guard.** `POST /api/queue` currently makes a new
  queue item every time, so re-capturing a work (or double-adding across tabs)
  creates duplicates. Add a check: if the work is already committed → "already in
  library"; already pending/needs_review → "already queued"; no new row. (Surfaced
  2026-06-17; review queue dedupes the *display*, and commit now resolves sibling
  queue items for the same work — 2026-06-18 — so orphans stop relisting; this
  remaining piece would stop the duplicate rows from being *created* at all.)

## Tag curation (do during the category-by-category review)
- **Evaluate dissolving the Dynamics category.** Many tags filed under Dynamics feel
  like they belong elsewhere — see whether the category can be split/absorbed.
- **Freeform → ship/character synonyms.** Some freeform tags are really ship/char
  synonyms ("Reylo" → Kylo Ren/Rey, "Poe - Freeform" → Poe Dameron). Sweep these in
  Tag Management (cross-kind synonyms are allowed). Currently marked uncategorized.
- **Identity category real-data audit** before locking the category list.

## Tag Management (nice-to-haves)
- **Rolled-up canonical "Uses" count** — show the combined count across a canonical
  tag + its synonyms, not just per-tag raw counts.
- **Table faceting** — co-occurrence-aware filtering in the Tag Management table
  (the Browse `dependentFacets` machinery could be reused). Deferred at scoping.
- **Unify the two "primary" controls into a "Role" facet** (Added 2026-06-22.) The
  filter bar currently has TWO different "primary" mechanisms that confuse: (1) the
  **"Primaries" quick chip** filters the *main list* to primary **ships**, and (2)
  the **"primary only" checkbox** beside the Fandom picker trims the *fandom dropdown's
  options* to primary **collections**. Same word, different scope (list vs sub-picker),
  neither says ship/collection. Agreed redesign (2026-06-22):
  - **Replace the "Primaries" chip with a "Role" `<select>`** in the Kind/Category/State
    cluster: options `Any role` / `Primary ship` / `Primary collection`. Self-labeling
    and consistent with the sibling dropdowns; covers BOTH primary roles symmetrically
    (lets you curate primary collections later too, not just ships).
  - **Move the "primary only" checkbox INTO the Fandom picker popover** (a small
    "Primary fandoms only" toggle at the top of its list) so it lives with the picker
    it refines and leaves the main bar. Keep default ON and the ability to show ALL
    fandoms (load-bearing for orphan curation — see [[storyhub-fandom-curation]]).
  - Net: one fewer top-level control; both "primary" ideas become explicit.

  Implementation notes:
  - **`pwa/src/data/tags.ts`**: a `readPrimaryShipTagIds(db)` already exists
    (`SELECT DISTINCT tag_id FROM work_tags WHERE is_primary_ship`). Add a twin
    `readPrimaryCollectionTagIds(db)` (`… WHERE is_primary_collection`) for the
    `Primary collection` Role value.
  - **`pwa/src/components/TagManagement.tsx`**:
    - Add `const [role, setRole] = usePersistentState<'all'|'primary_ship'|'primary_collection'>('sh.tm.role','all')`.
    - Memo `primaryCollectionTagIds` alongside the existing `primaryShipTagIds`.
    - In the `filtered` useMemo, **remove** the `quick.has('primaries')` clause and add:
      `if (role==='primary_ship' && !primaryShipTagIds.has(t.id)) return false` and the
      `primary_collection` twin. Add `role`, `primaryShipTagIds`, `primaryCollectionTagIds`
      to the deps array.
    - **Remove the "Primaries" chip** from the `tm__quick` group.
    - Add the Role `<select className="tm__select">` after the Kind select (mirror the
      State select's markup).
    - Include `role !== 'all'` in `filtersActive`; reset `setRole('all')` in `clearFilters`.
    - Old persisted `quickArr` may still contain `'primaries'` — harmless once the clause
      is gone (it just no-ops), but optionally strip it on load.
    - **FandomFilter** (the picker component used at the `<FandomFilter …>` site): pass
      `keptOnly`/`onToggleKeptOnly` (the existing `fandomKeptOnly` state stays in
      TagManagement) and render the toggle inside its popover; delete the
      `<label className="tm__keptonly">` from `tm__filters`. `keptFandoms` /
      `shownFandomOpts` logic is unchanged — only where the toggle renders moves.
  - **CSS** (`TagManagement.css`): drop/relocate `.tm__keptonly`; Role reuses
    `.tm__select`; add a small toggle style inside the picker popover.
  - **Optional follow-up (separate):** collapse the remaining quick chips
    (Uncategorized / Ungrouped / Needs review / Orphans) into a single compact
    "Flags ▾" multi-select menu with a count badge to further de-crowd the bar.
    Tradeoff: active toggle states no longer glanceable (one extra click).

## Tag / fandom curation (cont.)
- **Multi-fandom works (two genuinely "kept" fandoms).** User deferred 2026-06-19;
  keeping a single primary is fine for now. Key fact: Browse fandom filtering matches
  on ANY fandom tag a work carries (the primary is just the card's display label), so
  a true crossover already filters under both fandoms IF tagged with both. Two simple
  handlings if it ever gets annoying: (a) give a genuine dual-fandom work BOTH fandom
  tags — needs a "+ add fandom" button wiring the existing `POST /api/works/{id}/
  collections` endpoint into the ✎ PrimaryEditor (no UI yet); (b) for an interrelated
  SERIES that shifts fandom/ship story-to-story (e.g. the Stray Kids × ATEEZ series),
  use a starred **Reading List** as a fandom-agnostic single handle (existing feature,
  no build). AVOID multiple-primary-fandoms in the schema (overcomplication). See
  [[storyhub-fandom-curation]], [[storyhub-edit-primaries]].

## Dashboard
- **Excluded tags can still be a card's primary (snapshot-builder).** In
  `snapshot_builder.py`, `primary_ship`/`primary_collection` are assigned *before*
  the `is_excluded(tid): continue` skip, so an excluded tag still surfaces as a
  work's primary in Stats/Browse — and because the excluded tag is stripped from the
  card's filterable `tags` list, "open the fic" from that primary returns **no
  results** (dead link). Fix: only set the primary when `not is_excluded(tid)` (a
  work whose assigned primary is excluded then shows Gen). One-liner + content
  rebuild, no format bump. Dormant after the 2026-06-22 manual primary cleanup, but
  recurs whenever a future capture auto-assigns a junk/"&" primary that's later
  excluded. NOTE: this shows Gen, not a romantic "/" alternative — works with a real
  alt ship still need a per-work re-assign. (Surfaced 2026-06-22; user fixed data by
  hand, deferred the code fix.) See [[storyhub-stats-view]].
- **Persist scroll position** in Browse + Tag Management. Filters/search/sort now
  persist across navigation + reload (localStorage `usePersistentState`,
  [[storyhub-sticky-filters]]), but you still land at the TOP of the restored list.
  Deferred 2026-06-20 (user OK for now) — revisit if it bites on really long lists.
  Tricky because both lists are `@tanstack/react-virtual` virtualized: persist the
  scroll offset (or anchor work/tag id) and restore via `scrollToOffset` /
  `scrollToIndex` after the list + measurements settle. (Added 2026-06-20.)
- **Manual epub upload drop-zone** (v2 per `components/extension.md`) — drop an epub
  into the PWA when AO3/Railway is having a bad day; runs it through normalization.

## Worker — put Phase H into service (non-urgent; no current need to update the XTEINK)
Phase H (the thin worker) is built, deployed, and validated against real data, but
has never run for real. Circle back when you actually want to update the e-reader /
take a backup. (Added 2026-06-18.)
- **Configure + run the worker.** Fill `~/.storyhub/settings.json` (`railway_url`,
  `auth_token`, the `r2_*` creds, and optionally `xteink_sd_path` / `backup_dir`),
  then `python -m storyhub_worker` (tray) or `python -m storyhub_worker run`
  (headless). The Sync view pill should flip to **online**.
- **First real X4 transfer (end-to-end with hardware).** The only untested path —
  physical SD-card detection + a full first sync (~7k eligible epubs download =
  large first run; incremental after). Confirm the folder tree, the `_catalog/`
  EPUBs index on the device, and power-cycle to see new files. Logic is lifted
  verbatim from FFF but has not run against a real card under StoryHub.
- **First real backup_pull.** Point `backup_dir` somewhere with room; first run
  mirrors snapshot + all epubs, later runs are incremental (size-skip).
