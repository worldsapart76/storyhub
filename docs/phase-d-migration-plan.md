# Phase D — Calibre → Postgres migration plan

> Status: PROPOSED (2026-06-15), awaiting sign-off before implementation.
> Supersedes redesign §10's mechanics where they conflict (the §10 assumptions
> about `#all_*` / `#maturity` / negative-id counts were wrong against the live
> data — see "Data reality" below). The §10 *intent* stands; this doc is the
> grounded execution plan.

## 1. Data reality (live library, inspected 2026-06-15)

7,344 books in Calibre library `FanFiction`. Verified against the live server:

- **`#all_fandoms` / `#all_relationships` / `#all_characters`: empty for every
  book.** The doc's "map `#all_*` → tags" has no source data.
- **Tags live in Calibre's flat `tags` bag** (~25.7/book, 32k distinct), mixing
  every facet + bookkeeping noise (`FanFiction` ×4012, `Completed` ×3984,
  `Fanworks` ×2853).
- **`#maturity` (rating): empty for every book.**
- **NO_AO3 = 437 books** carry the sentinel `#ao3_work_id = "NO_AO3"` (not null).
  These are pre-AO3 local stories → negative ids. The other **6,907** have
  numeric AO3 ids (also in `identifiers.url`).
- **`#date_read`: null for all** — no read timestamps exist anywhere.
- Clean & curated: `#collection` (23 distinct), `#primaryship` (127 distinct;
  fan-shortnames like "Sterek"/"Malex"; `"Poly"` ×95), `#wordcount` (all),
  `#shortsummary` (7154), `#readstatus` (Unread 6844 / Favorite 262 / Read 150 /
  DNF 67 / Priority 21), series (731), multi-author (259).

### Epub vs AO3 test (decisive)
The FanFicFare epub title page does **not** preserve kind separation or order:
fandoms are mislabeled "Category", freeforms are merged with the AO3 category
facet under "Genre", and **all lists are alphabetized (AO3 order lost)** — which
would break the "first-listed = primary" heuristic. It only reliably preserves
rating, warnings, relationships, characters. **AO3 live gives every kind cleanly
separated, in order, plus availability — and is reachable from the migration PC.**

## 2. Decisions (locked 2026-06-15)

- **AO3-primary. NO epub metadata fallback — ever — unless explicitly requested.**
  Scrape the 6,907 AO3 works from the local PC (paced) for clean
  kinds/order/rating/warnings/availability. The epubs are **downloaded for the R2
  file backfill only**, never parsed for metadata. Works AO3 can't serve
  (deleted/restricted) are **recorded with that status, not epub-filled** —
  handling decided after the sample.
- **Scraped data lands in a separate local DB** (SQLite, `migration_cache.sqlite`,
  gitignored) so wiping/iterating Railway never loses or re-triggers the scrape.
  Backfill-only; discarded after go-live.
- **Sample-first.** Build + validate on a 50-work sample (5 fandoms × 10, varied)
  before the full run — both to start testing immediately and to check for AO3
  kickback.
- **Drop AO3's category facet** (M/M, F/M, F/F, Gen, Multi, Other) — no schema home.
- **read_status:** Favorite → `is_favorite=true` **+ `read_status=Read`**;
  Priority → Unread + a "Priority" reading list; Read/DNF as-is; `date_read` null.
- **Poly: no special logic.** Ex-`#primaryship="Poly"` works just take the normal
  first-listed-relationship primary (the intake heuristic). Poly grouping is a
  later Tag-Management concern, not seeded here.
- Negative ids for the 437 NO_AO3 (`source = pre_ao3`); their mapping (Calibre
  columns, not epub) is sorted out separately — they're outside the sample.
- Dev cycle is wipe-and-recreate from Calibre; the migration is re-runnable and
  idempotent.

## 3. Pipeline (staged, resumable)

All durable state lives in a **local SQLite cache** (`migration_cache.sqlite`,
gitignored) so it survives Railway wipes and the scrape never re-runs. Runs on
this PC; the load stage writes to live Railway Postgres (public URL) + R2.

0. **Reset + schema.** Reset the live DB (drops smoke-test rows), ensure the
   redesign schema is applied (redeploy/restart, or apply `schema.sql`).
1. **Calibre dump** → enumerate all 7,344 books via REST into cache table
   `calibre_books` (tags, custom cols, authors, series, identifiers, timestamp).
2. **AO3 scrape** → fetch `archiveofourown.org/works/{id}?view_adult=true`
   (browser UA), parse the work meta group into kinds + order + rating + warnings
   + summary HTML + series + wordcount + availability, into cache table
   `ao3_scrape`. Skips already-scraped (resumable). Pace ~1 req / 3–5 s. Handle:
   404 → `deleted`; login/restricted page → `locked`; transient → retry w/
   backoff. **No epub fallback** — failures are recorded with their status.
   *Sample-first:* scrape the 50-work sample, validate, then the full 6,907.
3. **R2 epub backfill** → download each epub from Calibre `/get/EPUB/{id}/{LIB}`,
   sha256, upload to `epubs/{work_id}.epub` (the file only — not parsed). Skip if
   R2 already has it (resumable).
4. **Load Postgres** → build rows (mapping §4) from the dump + scrape + hashes;
   write transactionally with upserts (idempotent).
5. **Verify** → count == 7,344; 437 negatives; collection/ship group names ==
   old `#collection`/`#primaryship` (XTEINK stability); spot-check N random works'
   kinds/rating/primary vs AO3 + Calibre.

## 4. Field mapping

**works** (per book):
| Column | Source |
|---|---|
| work_id | numeric `#ao3_work_id`; NO_AO3 → assigned negative `-1…-437` (ordered by Calibre id) |
| source / work_type | `ao3`\|`pre_ao3` / `fanfiction` |
| source_url | AO3 url; pre_ao3 → null |
| title | AO3 (current) else Calibre title |
| summary_html | AO3 summary (HTML) else Calibre `comments` (plain) else `#shortsummary` |
| short_summary | `#shortsummary` |
| wordcount | AO3 (current) else `#wordcount` |
| chapter_count / is_complete | AO3 ("Chapters n/m") / AO3 status else Calibre `Completed` tag |
| language | AO3 else `languages[0]` |
| series_name / series_index | AO3 else Calibre series/index |
| rating | AO3 (mapped enum) else null |
| read_status | `#readstatus` remap: Unread→Unread · Read→Read · DNF→DNF · **Favorite→Read** · Priority→Unread |
| is_favorite | `#readstatus == Favorite` (262) |
| pinned | false |
| date_read | null (none exist) |
| date_added | Calibre `timestamp` |
| availability | AO3 result: live\|deleted\|locked; pre_ao3 → `n/a` |
| epub_r2_key / epub_hash | `epubs/{work_id}.epub` / sha256 |
| cover_r2_key | null |

**authors / work_authors** ← Calibre `authors[]` in byline order.

**tags / work_tags** ← AO3 by kind, in AO3 order (position):
- fandom · relationship · character · freeform (AO3 "Additional Tags") · warning
  (AO3 archive warnings). **Drop** AO3 category (M/M…). Strip noise tags always.
- No epub fallback. NO_AO3 works map from Calibre columns only (handled
  separately, outside the sample). AO3 scrape failures are recorded, not filled.

**primary flags** (on the work's own tags):
- `is_primary_collection` → the work's first-listed fandom. Seed a `collection`
  tag_group named exactly the old `#collection` value (23), with that fandom as a
  member — preserves XTEINK collection folders.
- `is_primary_ship` → the work's first-listed relationship. Set that relationship
  tag's `display_name` = `#primaryship` (127 shortnames) — preserves XTEINK ship
  folders. Conflicts (same raw ship → different `#primaryship`) resolved by
  majority + flagged. **Poly (95): no special logic** — the `#primaryship="Poly"`
  string is ignored; the work just takes its first-listed relationship like any
  other (Tag Management handles poly later). Gen (no relationship) → null primary.

**tag_groups seeded:** collection groups (23) from `#collection`; ship
`display_name` aliases from `#primaryship` (excluding the "Poly" value). Synonyms
not seeded (the optional AO3 tag-page pull is parked, §9).

**reading_lists:** a manual "Priority" list with the 21 ex-Priority works; a
system "Favorites" list (membership_rule `is_favorite = true`).

## 5. Open items / smaller confirmations
- **Restricted (registered-only) AO3 works**: anonymous scrape can't read them →
  epub/Calibre fallback now; could re-scrape via the extension's authed session
  later (Phase E). Count unknown until the scrape runs (logged, not silently
  dropped).
- **title/wordcount/summary source**: plan prefers *current AO3* over the Calibre
  snapshot. Flag if you'd rather pin to the as-downloaded Calibre values.
- **`#primaryship` → `display_name` conflicts**: majority-wins + flagged for review.

## 6. Implementation shape
A standalone local script (`railway/migrate.py`, stages above) using asyncpg
(direct to Postgres, not the client API — migration is bulk/one-time), the
Calibre REST client, an AO3 scraper+parser, and boto3 for R2. Reuses
`seeding.py` for ship/collection grouping heuristics. Not built until this plan
is signed off.
