# Data model

> Source: §6 of the original StoryHub design doc.

## 6.1 Calibre custom columns [DECIDED]

Existing columns retained:
- `#ao3_work_id` (text)
- `#collection` (text)
- `#primaryship` (text)
- `#wordcount` (int)
- `#readstatus` (text — Unread / Priority / Read / Favorite / DNF)
- `#shortsummary` (text — used by catalog)

New columns added to Calibre (2026-06-13):
- `#date_read` (datetime) — set on every transition to Read / Favorite / DNF. Updated on re-reads (reflects most-recent-read activity, matching AO3 history semantics).
- `#all_fandoms` (text, multi-value "like tags") — raw AO3 fandoms list per work. Captured by extension at story-add time; backfilled for existing library via one-time extension scrape pass.
- `#all_relationships` (text, multi-value "like tags") — raw AO3 relationships list per work. Same capture/backfill pattern.
- `#all_characters` (text, multi-value "like tags") — raw AO3 characters list per work. Same capture/backfill pattern.
- `#maturity` (text, single-value) — AO3 rating (Explicit / Mature / Teen And Up Audiences / General Audiences / Not Rated). Named `#maturity` because Calibre's built-in `rating` is a 1–5 star integer column and would collide.

Note: `#collection` and `#primaryship` continue to exist and be populated as
the curated single-value normalized primary. They drive the X4 folder
structure (Collection/Ship/Status) and catalog EPUB grouping. StoryHub's
Browse view does not surface them — it uses the raw `#all_*` columns and lets
the user filter on any value in the lists.

**Date format convention [DECIDED]:** all `#date_read` writes use **noon UTC**
(`YYYY-MM-DDT12:00:00Z`). Calibre's datetime columns store full timestamps; if
we wrote local midnight, the displayed date could flip a day boundary in
clients viewing from a different timezone. Noon UTC sits comfortably in the
middle of every populated timezone's calendar day, so the date shown matches
the date the action happened regardless of viewer locale. The time-of-day
component carries no meaning — we use it only to stabilize the date.

**Already verified (2026-06-13):** `#date_read` exists in the live FanFiction
library with `datatype=datetime`. Currently null on all books — populated by
StoryHub's worker at launch (and by the AO3 History backfill for pre-launch
reads).

## 6.2 Calibre's built-in date_added [DECIDED]

Already populated automatically per book. Used for "library growth"
analytics. No new column needed.

## 6.3 Railway database (Postgres) [DECIDED on tables, OPEN on exact columns]

Tables (preliminary):

```
queue_items
  id, work_id, status (pending|fetching|importing|reviewing|done|failed),
  metadata_json, epub_r2_path, source, created_at, updated_at,
  calibre_id_assigned, review_payload, error_message

status_updates
  id, work_id, calibre_id, new_status, old_status,
  source, created_at, applied_at

snapshot_versions
  version, r2_path, created_at, book_count

ao3_actions
  id, work_id, action (bookmark|mark_read), status (pending|done),
  status_update_id, created_at, completed_at

worker_heartbeats
  id, worker_id, last_seen_at, recent_log_lines

reading_lists
  id, name, description, color, cover_image_url, auto_pin (bool),
  is_system (bool — true for built-in Favorites list),
  membership_rule (NULL for manual; e.g. "readstatus=Favorite" for built-in),
  created_at, updated_at

reading_list_members
  reading_list_id, calibre_id, position, added_at
  -- For system lists with a membership_rule, this table is computed/refreshed
  -- by the worker; user-edit operations no-op.

per_story_pins
  calibre_id, pinned (bool), updated_at
  -- Independent of reading-list auto-pin. Story may be pinned via this table OR
  -- via membership in an auto-pinned reading list; either implies device should
  -- cache the epub.

saved_filters
  id, name, filter_state_json, sort_state_json,
  starred (bool — true promotes to Browse chip row), display_order,
  created_at, updated_at

tag_states
  tag, state (favorite|normal|excluded), category, auto_classified (bool), updated_at
  -- state:
  --   'excluded' = hidden everywhere except Tag Management UI
  --   'favorite' = pinned top of category's chip grid
  --   'normal'   = default state
  -- category: one of the curated category names (Universe, ABO, Content, Trope,
  -- Dynamics, Mood, Structure, Other). Structural categories (Fandom, Relationship,
  -- Character, Rating) are NOT stored here — their entries come from #all_* and
  -- #maturity Calibre columns directly.
  -- auto_classified: true until user reviews/confirms in Tag Management

settings
  key, value_json   (single-row config for the user)
```

Each row carries IDs sufficient to be idempotent. Worker re-runs don't
double-apply.

## 6.4 R2 paths [DECIDED]

```
/epubs/{calibre_id}.epub
/snapshot/library-{version}.sqlite
/snapshot/current.json          (pointer: {version, r2_path, created_at})
/catalog/...                    (X4 catalog files — SD card path is primary; R2 mirror [DEFERRED])
/staging/{queue_item_id}.epub   (temporary, cleaned after import)
```

See also [components/cloudflare-r2.md](components/cloudflare-r2.md).

## 6.5 Snapshot format [DECIDED]

SQLite file. Tables roughly mirror Calibre's relevant fields plus computed
columns:

```
books
  calibre_id, ao3_work_id, title, author, summary_html, shortsummary,
  collection,        -- normalized single-value primary (used by X4 transfer)
  primaryship,       -- normalized single-value primary (used by X4 transfer)
  all_fandoms,       -- raw AO3 list, JSON-encoded; used by StoryHub Browse
  all_relationships, -- raw AO3 list, JSON-encoded; used by StoryHub Browse
  all_characters,    -- raw AO3 list, JSON-encoded; used by StoryHub Browse
  maturity,          -- raw AO3 rating (Explicit/Mature/Teen/General/Not Rated)
  wordcount, readstatus,
  date_read (datetime, ISO8601 with TZ),
  date_added (datetime, ISO8601 with TZ),
  epub_r2_url, language, series_name, series_index

book_tags
  calibre_id, tag

reading_lists (read-only mirror of Railway state)
  id, name, description, color, cover_image_url, auto_pin, is_system

reading_list_members
  reading_list_id, calibre_id, position

saved_filters (read-only mirror of Railway state)
  id, name, filter_state_json, sort_state_json, starred, display_order
```

Dashboard PWA downloads this once per snapshot version, caches in IndexedDB,
runs all filtering client-side. No round-trip to Railway for browse queries —
instant.

> **Hard rule:** do not change the snapshot format without bumping
> `snapshot_versions.version` — clients depend on the version for cache
> invalidation.
