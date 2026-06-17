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

## Capture / sync
- **Server-side duplicate-capture guard.** `POST /api/queue` currently makes a new
  queue item every time, so re-capturing a work (or double-adding across tabs)
  creates duplicates. Add a check: if the work is already committed → "already in
  library"; already pending/needs_review → "already queued"; no new row. (Surfaced
  2026-06-17; review queue currently dedupes the *display* as a stopgap.)

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

## Dashboard
- **Manual epub upload drop-zone** (v2 per `components/extension.md`) — drop an epub
  into the PWA when AO3/Railway is having a bad day; runs it through normalization.
