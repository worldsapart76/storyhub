# Calibre-removal redesign (proposed)

> **Status: ADOPTED (2026-06-14) — this is the forward design for StoryHub.**
> A clean-slate redesign that removes Calibre entirely. It now **supersedes** the
> Calibre-era design docs (architecture.md, data-model.md, build-phases.md,
> auth.md, ux/*, components/*) for all *new* work — but those still accurately
> describe the system being replaced, so keep them until the migration (§10) is
> moving smoothly, then retire them. Where this doc and a Calibre-era doc
> disagree, **this doc wins.**
>
> Created 2026-06-14 from an exploratory design conversation; adopted the same day
> after working through the data model (§2–11) and the operational design
> (§12.1–12.6). The originally-open item (`primary_collection` / `primary_ship`)
> resolved into the unified tag-grouping model (§6.3.1 / §9).

## 1. Premise

Calibre is currently the source of truth purely as a storage layer. None of its
value-add features are used (format conversion, epub viewer, desktop GUI
browsing). It forces StoryHub metadata into Calibre's column model (the
`#maturity`-vs-`rating` collision, multi-value "like tags" contortions, the
noon-UTC datetime hack, an opaque surrogate `calibre_id` requiring a write
round-trip). In StoryHub's target architecture Calibre has already been reduced
to two jobs — master metadata store and epub file storage — and both have
StoryHub-native homes designed (Postgres + R2).

**Goal:** remove Calibre, design the data model clean-slate ("what would we
build if nothing existed today"), not by porting Calibre's columns.

Backup concern is dismissed: a copy living on Railway is already more
redundancy than a lone Calibre library folder ever provided. A periodic
targeted backup (DB dump to R2 + local pull) is an optional add-on, not a
blocker.

## 2. Decision 1 — Primary key

**`work_id BIGINT PRIMARY KEY`.**
- Positive = the AO3 work id, verbatim. No surrogate, no round-trip to learn it.
- Negative = pre-AO3 local id, for the ~400 existing `NO_AO3` stories (assign
  `-1 … -400` at migration). AO3 ids are always positive, so negatives can
  **never** collide — provably, not "probably" (AO3 does have low-numbered
  early works, so positive `1, 2, 3…` would not have been safe).
- Future pre-AO3 / non-AO3 additions take `min(work_id) - 1`.

Paired columns: `source` enum (`ao3 | pre_ao3`, room for `other`) and
`source_url`.

Minor caveats (all trivial):
- Any AO3-URL construction must check `source`/sign first (never build a URL for
  a negative id).
- R2 epub keys read `/epubs/-5.epub` — works fine; optional `/epubs/pre/5.epub`
  prefix if the negative in a key bothers us.
- Mixed-range sorting by id is irrelevant (we sort by date/title).

## 3. Decision 2 — Source of truth & topology

**Railway Postgres becomes the single source of truth. No local master DB.**
The snapshot in R2 stays as its read-only, versioned projection (a `SELECT`
export, not a REST-scrape-and-map).

Consequences:
- **Metadata writes go client → Railway directly.** There is no write-relay
  queue anymore.
- **Normalization moves server-side.** Ship Rules 1–5 and collection keyword
  logic are pure computation (no AO3 access, no local hardware) → they run on
  Railway at insert time, pulling the worker out of the import path entirely.
- **AO3 sync actions** (mark-read / bookmark) are still queued, but drained by
  the **browser extension** on the next AO3 visit — never the worker.
- **The PC worker demotes to a thin local agent.** Its only remaining jobs are
  the things that physically can't run in the cloud:
  - **X4 / Crosspoint SD-card transfer** — needs the PC with the card inserted.
  - **Local backup pull** — fetching the periodic DB dump down to the PC.
  It polls Railway for "jobs to run on the PC"; it no longer stewards data.

Offline still holds: worker-offline → job queue accumulates on Railway;
PWA-offline → snapshot cached in IndexedDB. X4 / backup are PC-triggered and may
assume the worker is online.

## 4. FanFicFare — removed entirely

FFF's only remaining role was chapter-update detection on already-imported WIPs,
and it fails constantly (server-context AO3/Cloudflare blocking — the exact
problem the extension exists to solve).

**It is removed completely.** The user **never** adds incomplete stories — WIPs
are kept as AO3 subscriptions until complete, then added. So there is no WIP
state to track, no update detection, no re-fetch path. `chapter_count` /
`is_complete` survive only as captured-once informational facts that drive no
logic.

This also removes FFF's job from the worker, leaving the worker with **X4
transfer + local backup pull** as its entire remit.

## 5. Epub "open" behavior

**"Open" hands the epub to the OS default reader (or a reader picker)**,
mimicking the current CalibreFanFicBrowser behavior, with the in-PWA reader as a
universal fallback. **"View on AO3"** becomes a secondary action, shown only
when `source = ao3 AND availability = live`.

This resolves deleted/locked works and negative-PK pre-AO3 stories uniformly —
they all just open the stored epub, no special-casing. The hand-off *mechanism*
varies by surface (PC = worker file-association or browser download; mobile PWA
= share / "open with" intent); the model is consistent. The in-app reader
covers surfaces where hand-off is awkward.

## 6. Clean-slate schema

> Naming standardized on `works` (the entity holds fanfiction and, potentially,
> books) with join tables `work_authors` / `work_tags`. In conversation these
> were sometimes called `stories` / `story_*`.

### 6.1 `works`

```
work_id          bigint  PK        -- pos = AO3 id, neg = pre-AO3 local id
source           enum              -- ao3 | pre_ao3 | (other)
work_type        enum              -- fanfiction (default) | book
source_url       text
title            text
summary_html     text
short_summary    text              -- catalog
wordcount        int
chapter_count    int               -- informational only
is_complete      bool              -- informational only (we only add complete works)
language         text
series_name      text
series_index     numeric
rating           enum              -- Explicit | Mature | Teen | General | Not Rated
                                   --   (renamed back from #maturity; the Calibre
                                   --    star-column collision is gone)
read_status      enum              -- Unread (default) | Read | DNF
                                   --   (Priority & Favorite removed — see §8)
is_favorite      bool              -- orthogonal to read_status. AO3 bookmark =
                                   --   is_favorite (any bookmark). The system
                                   --   "Favorites" reading list is just
                                   --   membership_rule: is_favorite = true.
date_read        timestamptz       -- real timestamp; no noon-UTC hack
date_added       timestamptz
availability     enum              -- live | deleted | locked | n/a (pre_ao3)
last_seen_on_ao3 timestamptz
epub_r2_key      text
epub_hash        text
cover_r2_key     text  NULL        -- future non-fic only; fanfic covers out of scope
-- primary ship / collection are NOT columns. They are per-work roles flagged
-- on work_tags (is_primary_ship / is_primary_collection), valued by the
-- flagged tag's group — see §6.3.1 and §9.
created_at       timestamptz
updated_at       timestamptz
```

- `availability` rule: AO3 actions and any future re-check run only when
  `source = ao3 AND availability = live`. A 404/lock flips the flag instead of
  erroring; the work stays in the library, untouched, just marked.
- `work_type` is orthogonal to `source` (where it came from vs. what it is). If
  non-fic ever happens, prefer **tags for genre** over new columns; a
  `book_meta` extension table keyed by `work_id` is the clean move only if
  metadata genuinely diverges. Not building that now.

### 6.2 Authors (join table)

```
authors
  author_id   PK
  name        text                 -- AO3 pseud / byline name

work_authors
  work_id     fk -> works
  author_id   fk -> authors
  position    int                  -- preserves byline order; handles co-creators
  PK(work_id, author_id)
```

Chosen as a join (not a `text[]` array) for first-class browse-by-author later,
even though the ereader side can't use it under the current app.

### 6.3 Tags (first-class — replaces `#all_*` JSON columns *and* `tag_states`)

```
tags
  tag_id          PK
  name            text             -- raw AO3 tag text
  display_name    text  NULL       -- optional display alias (e.g. "Winterhawk",
                                   --   "Stucky"); shown on cards / X4 / filters
                                   --   in place of `name`. Synonyms inherit their
                                   --   canonical's display_name. See §6.3.1 refinement.
  kind            enum             -- fandom | relationship | character |
                                   --   freeform | warning
                                   --   (warning = AO3 archive warning; the
                                   --    Content category absorbs these — there
                                   --    is no #all_* / freeform home for them)
  category        text  NULL       -- NULL for structural kinds; for freeform
                                   --   (and warnings → Content). Curated SET in
                                   --   the `categories` table; current default:
                                   --   Identity | Universe | Content | Trope |
                                   --   Dynamics | Mood | Structure | Other
                                   --   (ABO removed 2026-06-16 — dynamics→Trope/
                                   --   Content, alpha/omega role→Identity)
  state           enum             -- favorite | normal | excluded
  auto_classified bool
  updated_at      timestamptz
  unique(name, kind)

work_tags
  work_id               fk -> works
  tag_id                fk -> tags
  position              int        -- AO3's per-work tag order (per kind);
                                   --   MIN(position) WHERE kind='relationship'
                                   --   = AO3's first-listed ship
  is_primary_ship       bool       -- designated primary role (≤1 true per work)
  is_primary_collection bool       -- designated primary role (≤1 true per work)
  PK(work_id, tag_id)
```

- A work's fandoms = `work_tags ⋈ tags WHERE kind = 'fandom'`. The three
  `#all_*` JSON columns vanish.
- `rating` stays a column (single-value per work), not a tag.

### 6.3.1 Tag grouping layer (canonicalization + concepts)

Raw `tags` are captured verbatim from AO3. A grouping layer sits on top to
(a) collapse synonyms, (b) roll distinct tags up into concepts, and (c) host the
curated ship/collection canonicalization the old normalization rules used to
emit as opaque strings.

```
tag_groups
  group_id         PK
  name             text     -- display/canonical name ("DCU", "Bucky/Clint",
                            --   "Slow Burn", "Poly")
  group_type       enum     -- ship | collection | synonym | property
  canonical_tag_id fk NULL  -- representative real tag, when one exists
                            --   (set for synonym/ship; usually NULL for
                            --    collection/property)
  parent_group_id  fk NULL  -- RESERVED, dormant in v1 (flat only). Lets tag
                            --   hierarchy switch on later without a migration.
                            --   Do NOT build traversal yet — see §9 parked.
  updated_at       timestamptz

tag_group_members          -- M:N: a tag may join several groups across types
  group_id   fk -> tag_groups
  tag_id     fk -> tags
  PK(group_id, tag_id)
```

**`group_type` — two semantics under four purpose names:**
- *Equivalence* ("same thing, collapse"): `synonym`, and `ship` (variants of one
  ship → one canonical).
- *Roll-up* ("distinct tags filed under one bucket/trait"): `collection`
  ("Batman", "Justice League" → DCU) and `property` ("Polyamory", "M/M/M",
  3-name ships → Poly).

The names stay distinct because behaviour differs downstream: ship & collection
drive the primary-role flags and the X4 folder tree; synonym drives
display-collapse in Browse; property drives trait filtering.

**Flat, not hierarchical (v1).** Groups contain only *tags*, never other groups.
`parent_group_id` is reserved but unused.

**Grouping is optional enrichment, not a gate.** A tag is fully usable with no
group, category, or non-default state — that is the *expected normal* for many
tags (low-interest tags, or backlog after a large influx). Browse and filters
operate on raw tags regardless; missing metadata never hides a tag, and it never
blocks an import. Curation is a filterable Tag-Management activity (§12.6), not a
queue to clear. (Detail in §12.1 auto-resolve and §12.6.)

**Resolution order (load-bearing):**
1. **Canonicalize** — map each raw tag to its canonical via its `synonym` (or
   `ship`) group. A tag has **at most one** synonym/ship group (within-type
   uniqueness — enforce with a partial unique index).
2. **Read concepts off the canonical** — `collection` / `property` membership is
   defined on *canonical* tags only; raw synonyms inherit it. Poly is marked
   once on canonical "Threesome - M/M/M" and all ~200 AO3 syns inherit it; a new
   syn added later inherits automatically (no drift, no silent gaps).
3. **Display** — show the canonical's name (one collapsed chip).

**Worked example.** Work tagged raw "Throuple - M/M/M":
`Throuple - M/M/M` ∈ synonym group `Threesome - M/M/M` (canonical) → that
canonical ∈ property group `Poly` → work has the Poly trait; Browse shows the
single chip "Threesome - M/M/M".

**Primary ship / collection are designated roles, not strings.**
`work_tags.is_primary_ship` / `is_primary_collection` flag the *actual* tag on
the work that is primary; the value surfaced (card display, X4 folder, catalog
grouping) is that tag's **group** name. Exactly one primary per axis per work —
this is where the X4 single-deterministic-path constraint now lives.

**The normalization rules demote to seeding heuristics.** Ship Rules 1–5 and the
collection keyword table (docs/lifted-from-fff/normalization-rules.md) no longer
emit `#primaryship` / `#collection` strings. They now *propose* group membership
and primary-role assignments, surfaced in the Review Queue for confirmation
(same write discipline). Stored truth is the membership edge + the primary flag,
not a derived string.

**Refinement (2026-06-14) — display aliases + three composable curation layers.**
Resolved while prototyping Tag Management. Tag curation is **three independent,
composable layers**; a tag may use any or all, and belong to several groups:

1. **Canonical + synonyms** (equivalence — "same thing, collapse"). One tag is the
   **canonical**; variants point at it as synonyms and collapse into it. This
   subsumes the old `ship` group type: a ship's spelling variants are just
   synonyms of the canonical relationship tag — **no group object is required for
   ships.** A canonical can be marked **standalone** (no pre-existing group).
2. **Display alias** (`tags.display_name`). Renames a tag's *display* without any
   group — e.g. `Bucky Barnes/Sam Wilson` → "Winterhawk". Synonyms inherit their
   canonical's alias. This is where the old `tag_groups.name` nickname for
   equivalence lives now; only true roll-ups keep a group-level name.
3. **Roll-up groups** (`tag_groups` of the *roll-up* semantics — collection /
   property). Bundle **distinct** tags under one freeform name. **Created from a
   tag row** (the originating tag is the first member, so a group is never empty),
   and the group's **class is inferred from member kind**, not set by hand:
   - members are **structural** (**fandom** or **relationship** — both map to an
     XTEINK folder level, the collection level and the ship level) → **collection**;
   - members are **descriptive** (character / freeform / warning) → **property**
     (a filter bundle only).
   Membership is gated by **behaviour class, not raw `kind`** — so an official
   `warning` and an equivalent `freeform` (same Content behaviour) may share one
   property group.

   **Synonyms are gated by a "domain":** a tag may be a synonym of a canonical only
   within the **same domain** — the **category** when it has one, else the **kind**
   (structural kinds have null category). So a `warning` and a `freeform` both in
   **Content** may be synonyms, but a `fandom` and a `relationship` (both
   null-category) may not.

**A roll-up group never overrides a tag's own primary / X4 identity.** A
relationship bundle like "Robin/Barbara Gordon" (grouping `Jason Todd/Barbara
Gordon` + `Dick Grayson/Barbara Gordon`) is filter-only; each work still files
under its specific ship via that ship's canonical + alias + the primary flag. So
the structural ship/collection display resolves from **(primary flag → the
flagged tag's canonical → its `display_name` else `name`)**, with the **collection
group name** substituting for a flagged *fandom* (the one case where the bundle
*is* the primary, by design). `tag_groups.group_type` collapses accordingly:
`ship`/`synonym` (equivalence) are handled by canonical + `display_name`;
`collection`/`property` (roll-up) remain, with class inferred as above.

### 6.4 Reading lists ("playlists")

```
reading_lists
  id, name, description, color,
  cover_image_r2_key   -- the 200×200 playlist-cover UPLOAD (the only place the
                       --   200×200 crop applies — NOT book covers)
  auto_pin, is_system, membership_rule, display_order,
  created_at, updated_at

reading_list_members
  reading_list_id  fk
  work_id          fk -> works
  position, added_at
```

### 6.5 Operational tables (carry over, re-keyed to `work_id`)

Largely intact from data-model.md §6.3, with calibre fields removed:
- `queue_items` — **drop `calibre_id_assigned`** (no external system assigns an
  id); full schema + state machine in §12.1 (normalization now server-side).
- **`status_updates` — eliminated.** Status/favorite changes are direct
  `UPDATE works` writes; `updated_at` / `date_read` cover "when did this change."
  (§12.2)
- `ao3_actions` — `work_id`, `action` (`mark_read | bookmark | remove_bookmark`),
  `params` (`{private:true}` for bookmark), `status`, …; full schema + drain
  model in §12.2.
- `worker_heartbeats`, `snapshot_versions` (`work_count`), `saved_filters`,
  `settings` — unchanged in shape.
- **`tag_states` — eliminated** (folded into `tags`).

### 6.6 Schema realization notes (2026-06-15, Phase A build)

Three points the schema above left implicit or in tension were resolved when the
schema was first implemented in `railway/app/schema.sql`. Recorded here so the
doc and the DDL stay in sync (cheap to revisit — the dev cycle is
wipe-and-recreate from Calibre until go-live).

1. **Synonyms/ships are stored on `tags.canonical_tag_id` (self-FK), not as
   `tag_groups` rows.** Follows the 2026-06-14 refinement to §6.3.1 ("no group
   object is required for ships"). A synonym row points `canonical_tag_id` at its
   canonical; a canonical or plain tag leaves it NULL — so "≤1 synonym per tag"
   is enforced by the single column. Consequently `tag_groups.group_type` is
   restricted to the two **roll-up** semantics (`collection`, `property`); the
   reserved `ship` / `synonym` enum values are not used. The within-domain
   synonym gate (§6.3.1) is enforced app-side in Tag Management, not by a DB
   constraint.
2. **`tags.category` is a text FK to `categories(name)`** (`ON UPDATE CASCADE`,
   `ON DELETE SET NULL`), keeping §6.3's `category text` while honoring §12.6's
   `categories` table. Renames cascade; Browse boxes key on the displayed name.
3. **`works.pinned boolean` is a column on `works`.** §6 never homed the
   per-work pin the prototype's card surfaces (the Calibre-era `per_story_pins`
   table is gone). It flattens onto the card in the §12.3 projection, so it lives
   on the work row. (Revisit if pin state ever needs to be device-scoped rather
   than global.)

4. **`reading_lists.starred boolean`** (added 2026-06-16, Phase F). §6.4 left this
   off, but the prototype stars reading lists to surface them as Browse quick-chips
   (alongside starred `saved_filters`). Added a `starred boolean NOT NULL DEFAULT
   false` column mirroring `saved_filters.starred`, rather than overloading
   `display_order`. The system "Favorites" list is always-starred in the UI.

Also realized: `snapshot_versions` carries an explicit `format_version` column
(§12.3's structure version) alongside the content `version`.

## 7. R2 paths (re-keyed)

```
/epubs/{work_id}.epub                 (negative ids fine; optional /epubs/pre/{n}.epub)
/covers/{work_id}.jpg                 (future non-fic only)
/reading-list-covers/{id}.jpg         (200×200 upload)
/snapshot/library-{version}.sqlite
/snapshot/current.json                (pointer)
/staging/{queue_item_id}.epub         (temporary)
```

## 8. What disappears

- `calibre_id` everywhere → `work_id`; `calibre_id_assigned` dropped.
- `#all_fandoms / _relationships / _characters` JSON columns + `tag_states`
  → `tags` / `work_tags` (+ the `tag_groups` grouping layer, §6.3.1).
- `#collection` / `#primaryship` single-value curated string columns → the
  `is_primary_collection` / `is_primary_ship` roles on `work_tags`, valued via
  the grouping layer (§6.3.1).
- The synthetic `"Poly"` `#primaryship` value (old Ship Rule 3) → gone. Poly is
  now a `property` group; poly works still get their real primary ship. (Its
  only purpose — bounding Calibre's ship dropdown — is moot without Calibre.)
- `read_status` values `Priority` and `Favorite` → removed. **Priority** was an
  artificial "read-next" device; it becomes an ordinary reading list.
  **Favorite** is a sentiment orthogonal to reading progress; it becomes the
  `is_favorite` bool (and the system "Favorites" reading list). `read_status` is
  now `Unread | Read | DNF`. On the XTEINK device the Status
  folder set becomes `{Unread, Favorite}`, with `is_favorite` driving the
  `Favorite` folder as a **transfer-time override** (§12.5); only `Priority`
  leaves the device (it is now an in-app reading list, not synced).
- `#maturity` naming workaround → `rating`.
- Noon-UTC datetime convention → plain `timestamptz`.
- Worker's Calibre REST client + HTTP Digest auth + duplicate-add response
  handling.
- The Calibre Content Server process itself.
- FanFicFare entirely (and its worker job).
- The "single bulk-enumeration from Calibre REST" concern (open-questions.md) —
  moot; reads come straight from the master DB.

## 9. Resolved — tag model & primary ship/collection roles

**Resolution (2026-06-14).** `primary_collection` / `primary_ship` are **stored
first-class as designated tag roles** — not pure X4 plumbing, not opaque string
columns. The scoping fork ("X4-only?" vs "also a Browse dimension?") resolved to
*Browse dimension too*: the Browse result card already shows primary ship, and
the grouping layer that powers them serves Browse generally.

How they're modelled (full detail in §6.3.1):
- `work_tags.is_primary_ship` / `is_primary_collection` flag the actual tag on
  the work that is primary. **Exactly one per axis per work** — the new home of
  the X4 "one deterministic folder path" constraint.
- The value surfaced (card, X4 `Collection`/`Ship` folder, catalog grouping) is
  the flagged tag's **group** name, not the raw tag.
- Set by auto-suggestion (lowest-`position` relationship tag → its ship group;
  collection keyword → collection group) → user override → Review Queue confirm.
  The old normalization rules become the seeding heuristics.

**Poly fics get a real primary ship** (not a synthetic `"Poly"` folder). Poly is
captured as a `property` group for filtering; the X4 Ship folder is still the
work's actual designated ship. The single-value constraint holds for every work,
poly included. (May spot-check on the device, but expected fine — the synthetic
value only ever existed to bound Calibre's ship dropdown.)

### Parked follow-ups
- **Tag hierarchy** — `parent_group_id` is reserved but dormant; flat grouping
  covers every case raised. Re-evaluate once real data is in the tables and
  queryable. The only case that would need it: a named, collapsible mid-tier
  group that *also* auto-rolls into a broader named group without
  double-maintaining membership — and Browse's category axis covers the umbrella
  need today.
- **One-off AO3 tag-page pull** — optional manual pass over common,
  variant-prone tags to seed `synonym` groups (AO3's "Tags with the same
  meaning" list) and, as a bonus, `collection`/meta roll-ups. Capture a
  *superset* per tag (name, canonical?, full syns, parent/meta tags, work count)
  into a staging file so it re-maps to the final schema. Does **not** seed
  `property` groups — Poly etc. are user-defined cross-cutting concepts, absent
  from AO3 wrangling.

## 10. Migration (one-time)

1. Export Calibre metadata → Railway `works` (key by `#ao3_work_id`;
   `NO_AO3` rows → negatives `-1 … -400`).
2. Parse Calibre author field → `authors` / `work_authors`.
3. Map `#all_*` + `tag_states` → `tags` / `work_tags`. Seed `tag_groups` /
   `tag_group_members` (synonym/ship/collection/property) from the old
   normalization rules + the optional one-off AO3 tag-page pull (§9 parked).
   Map `#collection` / `#primaryship` → `is_primary_collection` /
   `is_primary_ship` flags on the matching `work_tags` rows. **Preserve the
   original `#collection` / `#primaryship` strings as the corresponding group
   names** so XTEINK device paths stay stable (§12.4).
4. Backfill epubs (Calibre library → R2, keyed by `work_id`). Already roadmapped
   as the R2 backfill (~7,344 books, ~3.5 GB; pace politely).
5. Read-status remap: `#readstatus = Priority` → set the work's base status
   (Unread, or Read if it had been read) **and** add it to a "Priority" reading
   list; `#readstatus = Favorite` → `is_favorite = true` plus base status.
   Result: `read_status` lands as `Unread | Read | DNF` only.
6. Keep Calibre read-only as a safety net until verified (count + spot-check);
   then retire it from the pipeline. Calibre may stay installed as an
   out-of-pipeline break-glass inspector.

## 11. Settled side-decisions (from the design conversation)

- Author handling: **join table** (not array).
- Background WIP update detection: **not needed** (only complete works added).
- Discriminator name: **`work_type`** (not `type` — overloaded/ambiguous; not
  `kind`).
- Book covers: out of scope; single nullable `cover_r2_key` hook reserved for a
  hypothetical future non-fic expansion.

## 12. Operational design (capture → commit, sync, snapshot, worker, X4)

> Added 2026-06-14 as the redesign moves from data-model to implementable spec.
> Built incrementally; each subsection is confirmed before the next is written.

### 12.1 Import flow & queue contract

**Capture (extension → Railway).** Triggered by hooking AO3's **Mark for Later**
(§12.2). The extension captures *raw* AO3 metadata and the epub and does **no
normalization**. `POST /api/queue` payload:
- `ao3_work_id` (becomes `work_id`, positive — known at capture, no round-trip),
  `source_url`, `title`, `summary_html`
- raw lists **in AO3 order**: `fandoms[]`, `relationships[]`, `characters[]`,
  `warnings[]`, `freeform_tags[]`
- `rating`, `wordcount`, `chapter_count`, `is_complete`, `series_name`,
  `series_index`, `language`, `authors[]` (byline order)

**Epub naming & lifecycle — storage is id-keyed; human names applied only at
delivery.**
1. The AO3-supplied filename is discarded (irrelevant).
2. Upload via a **presigned R2 PUT** Railway mints when the queue item is created:
   key `/staging/{queue_item_id}.epub`. Bytes go extension→R2 directly; Railway
   stays light.
3. On commit Railway **copies** staging → `/epubs/{work_id}.epub`, then deletes
   the staging object.
4. Human-friendly names are generated at delivery only — never in storage:
   - external-reader / PWA download → `Content-Disposition: {sanitized title}.epub`
   - X4 SD card → `[NNN]-Title.epub` (XTEINK format, hard rule; worker-applied)

**`queue_items` (Postgres).**
```
queue_item_id   uuid PK
work_id         bigint            -- the AO3 id, known at capture
source          enum              -- ao3 (extension) | manual | ...
raw_metadata    jsonb             -- the raw payload above, verbatim
staging_key     text              -- /staging/{queue_item_id}.epub
state           enum              -- pending | normalized | auto_committed |
                                  --   needs_review | committed | failed
proposals       jsonb NULL        -- normalization output (primaries + tag rows)
error           text NULL
created_at, updated_at timestamptz
```
(`calibre_id_assigned` is gone — nothing external assigns an id.)

**Normalization at insert (Railway — pure compute, no AO3, no PC).** On receipt
Railway runs the (demoted) ship rules + collection keyword logic as
*proposals*, not string output:
- propose `is_primary_ship` = the lowest-`position` relationship tag (AO3
  first-listed); null if the work is gen (no relationship tag);
- propose `is_primary_collection` = the lowest-`position` fandom tag (AO3
  first-listed);
- create `tags` rows for unseen raw tags (un-grouped, un-categorized) — these
  **never block import**.
State → `normalized`. The primary is a *flag on the work's own tag*
(`is_primary_*`), **not** a group choice — group/synonym resolution for display is
the separate layer (§6.3.1), curated in Tag Management (§12.6), never here.

**Auto-resolve vs. review (corrected 2026-06-14 — see note).**
- **Auto-commit** iff each axis is unambiguous: **≤1 fandom and ≤1 relationship**
  (gen = 0 ships counts as unambiguous → `is_primary_ship` null). The single (or
  absent) candidate takes the primary flag; the AO3 first-listed is the default.
  Ungrouped/uncategorized tags — primary or not — do **not** block; grouping is
  optional enrichment (§6.3.1) done later in Tag Management.
- Otherwise (**>1 fandom or >1 relationship**) → `needs_review`. **Only the
  primaries gate review.**

**Per-work Review Queue — primaries only.** The user picks **which of the work's
own raw tags** carries each primary-role flag (`is_primary_ship` /
`is_primary_collection`), with the AO3 first-listed pre-selected; confirm-as-is or
change, then commit. The Review Queue **never creates or assigns groups and never
touches tags** — grouping/synonym/category curation is the Tag Management utility
(§12.6), a filterable surface. The card later *displays* the flagged tag via its
group/synonym (e.g. a flagged `Bucky Barnes/Sam Wilson` shows as `Winterhawk` once
that synonym is set in Tags).

> **Correction note (2026-06-14).** An earlier draft of this subsection had the
> Review Queue *resolve each primary to a group / create groups inline*, and gated
> review on whether the primary resolved to an existing group. That contradicted
> §6.3.1, §9, and §12.6 — the primary is a flag on the work's own tag, grouping is
> optional enrichment owned **solely** by Tag Management, and "the Review Queue
> never touches tags." Corrected: the gate is **ambiguity** (>1 candidate on an
> axis), and the queue only sets the primary flag among the work's own tags.
> All grouping/synonym work lives in §12.6.

**Commit sequence (Railway, transactional where possible):**
1. upsert `works` (read_status default Unread, is_favorite default false) +
   `work_authors`
2. insert `work_tags` (`position`, `is_primary_ship`/`is_primary_collection`)
3. copy staging epub → `/epubs/{work_id}.epub`; set `epub_r2_key` / `epub_hash`
4. delete staging object
5. bump `snapshot_versions.version`
6. `queue_items.state` → `committed`

**Open edge case (deferred to §12.5, X4):** works with no relationship tag (gen)
have a null primary ship — the X4 `Ship` folder level needs a defined fallback
bucket (e.g. `Gen`). Recorded here; resolved in the X4 subsection.

### 12.2 Status, favorite & AO3 sync

**No status queue, no audit log.** Read-status and favorite changes are direct
`UPDATE works` writes (which bump `updated_at`); `date_read` stamps reads. The
old `status_updates` relay table is **dropped** (§6.5); the Sync-view activity
feed derives from `updated_at` / `date_read`.

**Two-way sync, action → end-state.** StoryHub and AO3 are kept consistent. Each
deliberate action has a defined target end-state across *both* systems; the
extension is what reaches AO3 (the app has no AO3 session).

| Action | StoryHub write | AO3 end-state |
|---|---|---|
| Read | `read_status=Read` + `date_read` | marked read |
| DNF | `read_status=DNF` | marked read |
| Favorite | `is_favorite=true` + `read_status=Read` + `date_read` | marked read **+ private bookmark** |
| Un-favorite | `is_favorite=false` (read state unchanged) | bookmark removed — **app guards with an "are you sure?"** (curated bookmarks; un-favorite is the only AO3-destructive app action) |
| Unread | `read_status=Unread` — **allowed as a deliberate app correction** | **Mark for Later** (re-marks for later; AO3's Read↔MfL toggle) |

> **Unread amended (2026-06-16).** Originally "never written." Revised: AO3's
> *Mark for Later* ↔ *Mark as Read* is a real toggle, so Unread is a legitimate,
> syncable state when set deliberately in the app/extension (enqueues
> `mark_for_later`). The original protection — never *clobber* a deliberate
> Read/DNF/Favorite back to Unread — now lives on **import only** (fresh imports
> default to Unread; sync never PATCHes Unread), not as a blanket write ban.

Bookmarks are **always private** — baked into the action, never a user choice.
Note `is_favorite` stays *schema-orthogonal* to `read_status` (the column can
represent favorite-while-unread for odd inbound cases), but the deliberate
Favorite *action* sets both.

**Capture is the entry action.** Hooking AO3's **Mark for Later** adds a work
(§12.1). It then sits Marked-for-Later on AO3 until a Read/DNF/Favorite action
marks it read — mirroring AO3's natural MfL→read lifecycle.

**UI — hook AO3's real buttons; inject only DNF.**
- **Mark for Later** → capture · **Mark as Read** → Read · **Bookmark** → Favorite
- **DNF** → the single injected control (AO3 has no equivalent)
The extension **guarantees the target AO3 end-state idempotently** (re-marking an
already-read work is a no-op), so correctness never depends on intercepting a
native click.

**Where the queue applies:**
- **Acted in the app** (no AO3 session) → write `works` directly **and** enqueue
  the AO3 side-effect(s) in `ao3_actions` (Favorite enqueues two: `mark_read` +
  `bookmark`).
- **Acted on AO3** (extension present) → write `works` directly **and** perform
  the AO3 side-effect(s) inline. No queue.
- **On any AO3 page load** → flush pending `ao3_actions`, then ack. The only
  automatic on-AO3 behavior; it performs only actions you already chose in the
  app and never derives state from a visit.

**`ao3_actions` (the one real queue):**
```
ao3_actions
  id          PK
  work_id     fk -> works
  action      enum   -- mark_read | mark_for_later | bookmark | remove_bookmark
  params      jsonb  -- {private: true} for bookmark
  status      enum   -- pending | done | failed
  created_at, done_at  timestamptz
```

### 12.3 Snapshot projection

The snapshot is the read-only, versioned SQLite the PWA/extension download and
query client-side (IndexedDB). Postgres stays the normalized source of truth; the
snapshot is a projection **optimized for fast finding** — the governing goal is a
snappy, intuitive "find the story I want" experience, and every choice here
serves that.

**Build owner & trigger.** **Railway** builds the snapshot (a `SELECT` export),
uploads it to R2, and updates `current.json` on every committed change. The
worker is never involved (it's thin now) — a change from the old
worker-exports-after-Calibre-write model.

**Contents — hybrid (relational + precomputed display).**
- *Relational tables* (so advanced filtering / Tag Management keep the structure):
  `works`, `tags`, `tag_groups`, `tag_group_members`, `work_tags`,
  `work_authors`, `reading_lists`, `reading_list_members`, `saved_filters`.
- *Precomputed per-work projection* (so Browse needs **no** client-side joins or
  group resolution): each work flattened to its **effective canonical tags**
  (synonyms already collapsed per §6.3.1), its **primary ship / primary
  collection group names**, author byline, and card fields (title, summary,
  wordcount, read_status, is_favorite, rating, series). Computed once at build —
  never re-run on the device.
- *Excluded:* all operational tables (`queue_items`, `ao3_actions`,
  `worker_heartbeats`) — server-only.

**Versioning — two concepts.**
- `snapshot_versions.version` = **content** version. Bumps on any committed data
  change; clients compare via `current.json` and re-download when it differs.
- a **format** version = the snapshot *schema* shape; bumps only on a code change
  to the projection (the CLAUDE.md hard rule). Lets clients invalidate a
  structurally-incompatible cache, distinct from "just newer data."

**Snappiness (the governing goal).**
- A client that makes a change writes it **optimistically** to its own IndexedDB
  immediately — it never waits on a snapshot rebuild. The content-version bump
  only triggers a **background** re-download for cross-device consistency.
- Browse filtering runs entirely against the local precomputed projection — no
  network, no joins, no re-resolution.
- v1 downloads the full snapshot per content version (single-user, few devices, a
  few MB — fine). **Incremental/delta sync is parked** as a later optimization if
  full re-download ever feels heavy.

### 12.4 Worker contract (thin local agent)

Most of the *built* worker is reusable — the engine poll-loop, Railway client,
heartbeat, config, and tray are backend-agnostic. **Deleted:** `calibre.py` + the
Calibre/FFF config. **Changed:** what the loop does per item.

**Remit:** only the two PC-bound jobs — **X4 SD-card transfer** and **local
backup pull**. No data stewardship.

**Job dispatch — `pc_jobs` queue.** Dashboard triggers a job → Railway enqueues →
worker polls, runs, reports status/log → dashboard shows the result. Reuses the
existing poll/ack loop.
```
pc_jobs
  id PK, job_type enum (x4_transfer | backup_pull),
  params jsonb,                 -- e.g. {expected_snapshot_version: N}
  status enum (pending|running|done|failed),
  log text, created_at, started_at, finished_at
```

**Library source for transfer.** The worker reads the **latest snapshot from R2**
(it already carries resolved primary ship/collection group names + read_status —
the exact X4 tree inputs) and pulls epubs from `/epubs/{work_id}.epub`. Railway
rebuilds the snapshot on every change, so it is current; the job carries the
expected snapshot version as a freshness guard.

**Heartbeat + logging — kept as built.** `worker_heartbeats` gates the dashboard's
Transfer button; `~/.storyhub/worker.log` + ring buffer feed the activity view.

**Transfer naming / dedup stability across the migration** (full eligibility
redefinition in §12.5):
- **Filenames unchanged.** `[NNN]-Title.epub` derives from `wordcount`
  (preserved) and `title` (preserved) → byte-identical names to today.
- **Collection / ship folders unchanged** *iff* migration names the collection
  and ship groups exactly as the old `#collection` / `#primaryship` strings —
  **migration requirement** (§10 step 3).
- **Folders that DO move:** (1) **poly fics** — old `Poly/` ship → their real
  primary-ship folder; (2) works whose **Status** changes under the new
  eligibility (Priority/Favorite removed, §12.5).
- The existing **skip-by-full-target-path + remove-old/add-new** logic already
  handles moves (it's how Unread→Favorite always worked). The first
  post-migration transfer is a **larger one-time reshuffle**, but self-correcting.
- **Crosspoint caches by epub content hash, not path.** Migrated epubs are the
  same Calibre bytes (§10 step 4) → moved files keep their hash → no re-indexing,
  just file-copy time. No special one-time maintenance required; the reshuffle is
  cost-only, not correctness.

### 12.5 X4 / XTEINK transfer logic

Near-identical to the battle-tested FFF behavior (docs/lifted-from-fff/
xteink-transfer.md + xteink-catalog.md — folder structure and filename format
unchanged, hard rule intact). Only the read-status/favorite remodel touches it:

**Eligibility (what transfers).** A work goes on the device iff
`is_favorite = true` **OR** `read_status = Unread`. Read/DNF without the favorite
flag never transfer and are removed from the device if found (unchanged).

**Status folder — `is_favorite` overrides, derived at transfer time (not
stored).** The 3-level `Collection/Ship/Status/[NNN]-Title.epub` structure is
unchanged; the `Status` value is computed:
- `Favorite` if `is_favorite = true` (overrides read state — a favorited work
  rides along even if Read);
- else `Unread`.
Managed Status set is now `{Unread, Favorite}` — `Priority` simply disappears.
`is_favorite` stays a plain flag in the model; the transfer maps it to a
pseudo-status purely for the folder tree.

**Ship fallback — synthetic `Gen`.** Works with no primary ship get a
transfer-time `Gen` ship folder (a fallback label used only by the tree builder,
not a stored ship group), so gen fic keeps a deterministic path.

**Poly ships** use the work's real primary-ship group name — no more `Poly/`
folder (§6.3.1).

**Catalog.** Regenerated fresh each run; per-fandom indices return to the
original **Favorites By Ship** + **Unread By Ship** (favorites are back on the
device). The old "Priority entries first" sub-sort within Unread is removed.
Solo-fandom partitioning config unchanged.

**Migration path impact (refines §12.4).** Old `Favorite`-status works →
`is_favorite = true` (§10 step 5) → Status `Favorite` → **same path, no move**.
Only **ex-`Priority` works** relocate (Priority/ → Unread/ or Favorite/ per their
flags) and **poly fics** (→ real ship). Everything else stays put — a modest
first-run reshuffle, not a rebuild.

### 12.6 Tag Management, saved filters & category list

**Tag Management — a filterable surface, not a queue.** The single home for all
tag curation (the Review Queue never touches tags — §12.1). Lists every tag with
`kind`, `category`, `state`, group memberships (synonym/ship/collection/
property), `auto_classified`, and library frequency. "Work to do" is expressed as
*filters*, never a backlog you must clear:
- `uncategorized` (`category IS NULL`), `ungrouped` (no synonym/ship group),
  `needs review` (`auto_classified = true`), by `kind`, by `state`.
- Bulk-select → assign category, set state, create/assign a group, mark a
  canonical.

**Saved filters reference resolved entities.** A saved filter stores the same
tokens Browse shows: the **group** where one exists, else the **raw tag**. So a
"Slow Burn" filter auto-includes a future "slowburn" synonym (it filters the
group). Terms match against the snapshot's precomputed canonical projection
(§12.3); on load, any term that no longer resolves (e.g. a raw tag that since
joined a group) is **re-validated and visibly flagged**, never silently dropped
(no-silent-caps).

**Category list — a `categories` table.** The category *set* has order (Browse
render order) and a lock, so it gets its own table rather than loose strings:
```
categories
  id PK, name, display_order
  -- single global lock lives in `settings` (lock_category_list bool)
```
`tags.category` references it. **"Lock category list"** flips the global lock;
after lock, add/rename/reorder is a code change (preserves the hard rule). The
Phase-7 auto-classifier writes proposals as `auto_classified = true`; reviewing
the "needs review" filter is the natural pre-lock step (auto output is never
authoritative — hard rule).

**Graceful degradation in the filter UI** (formalizes §6.3.1). Missing metadata
never hides a tag: **uncategorized** tags fall into the **Other** box (its
existing dual purpose, browse.md §7.3.1); **ungrouped** tags render as themselves
(no collapse); both filter normally. Blanks are always usable.

---

*Operational design §12.1–12.6 complete. With the data model (§2–11) this is a
buildable spec; the build sequence is §13.*

## 13. Build sequence (re-sequenced — supersedes build-phases.md)

> Replaces the Calibre-era docs/build-phases.md. Order reflects dependencies;
> build top-down.

**Already built & reusable (Calibre-era):** Railway skeleton — `railway/app/`
Bearer auth, asyncpg pool, lifespan, router pattern, `/health`; worker shell —
tray, autostart, config loader, Railway client, engine poll-loop, logging.
**Discard:** `worker/calibre.py`; the Calibre/FFF/X4-tuning sections of
`worker/config.py`; the Calibre-shaped fields in the current schema
(`calibre_id_assigned`, `status_updates.calibre_id`, `per_story_pins.calibre_id`).

**Phase A — Postgres schema + core API.** Implement the full §6/§12 schema
(works, authors, work_authors, tags, tag_groups, tag_group_members, work_tags,
categories, reading_lists, reading_list_members, saved_filters, queue_items,
ao3_actions, pc_jobs, worker_heartbeats, snapshot_versions, settings). Rework
existing routers to it; add works / tags / groups read+write endpoints. Reuse
auth + pool. *Everything hangs off this — build first.*

**Phase P — UI design & prototyping (review gate before any client UI).** Sits
after Phase A and may run in parallel with backend Phases B–D, but is a **hard
gate**: no client UI is wired until it is signed off. Produces **unwired** design
only (mock data, no API, no real epubs). Deliverables, each reviewed before the
next:
- **Information architecture & navigation** — the surface map: Browse, story card
  + reading flow, Review Queue, Tag Management, Reading Lists, Saved Filters,
  Sync/worker view, the extension's injected controls.
- **Design system** — layout, component kit, compact labels (e.g. "OR/AND"),
  light/dark, mobile-first responsive rules.
- **High-fidelity mockups / click-through prototype (mock data, explicitly
  unwired)**, priority order: Browse + filter panel (the snappy-finding core,
  §12.3 / docs/ux/browse.md) → story card + reading flow → Review Queue
  (primaries-only, inline group create, §12.1) → Tag Management (filterable
  surface, §12.6) → Reading Lists / Saved Filters → Sync view.
- **Sign-off** before Phases E / F / G and the Review-Queue screen are built.

The existing docs/ux/*.md are the UX source (still largely valid; reconcile
tag/Browse specifics against §6.3.1 / §12.6). The prototype may be built as
mock-data React components so it can later become the Phase F scaffold — but it
stays unwired until sign-off.

**Phase B — Normalization + import pipeline (server-side).** Ship rules +
collection-keyword logic as group-membership/primary *proposals* (§6.3.1, §12.1);
`POST /api/queue` (raw payload) + presigned staging PUT; normalize-at-insert;
auto-resolve vs. `needs_review`; per-work Review Queue confirm endpoint (primaries
+ inline group create); commit (write works/work_tags/work_authors, copy staging
→ `/epubs/{work_id}.epub`, snapshot bump).

**Phase C — Snapshot builder.** Railway `SELECT` export → SQLite (relational
tables + precomputed canonical projection, §12.3); upload to R2; bump
`snapshot_versions`; update `current.json`. Format + content version.

**Phase D — Migration / backfill (one-time, §10).** Calibre → works/authors;
`#all_*` + `tag_states` → tags/work_tags; seed tag_groups from the normalization
rules (+ optional AO3 tag-page pull); `#collection`/`#primaryship` → primary
flags + groups (preserve names for XTEINK, §12.4); read-status remap
(Priority→list, Favorite→`is_favorite`); R2 epub backfill keyed by `work_id`;
verify (count + spot-check) vs. read-only Calibre. *Populates the library; runs
once schema + snapshot exist.*

**Phase E — Extension.** Hook AO3 Mark-for-Later → capture; hook Mark-as-Read /
Bookmark; inject DNF; write `read_status`/`is_favorite` directly + perform
`ao3_actions` inline; drain pending `ao3_actions` on AO3 page load; snapshot cache
for badges (§12.1–12.2).

**Phase F — PWA dashboard.** Snapshot → IndexedDB; Browse (category boxes,
tri-state chips, group/synonym collapse from the projection, search, sort);
optimistic status/favorite writes → Railway; reading lists; saved filters;
reading flow (open epub external / in-app). The snappy-finding core (§12.3).

**Phase G — Tag Management utility (PWA).** Filterable surface (§12.6): category
assign, group/synonym/canonical curation, state; `categories` table + Lock;
auto-classifier (Haiku 4.5) on initial seed + new tags, flagged `auto_classified`.

**Phase H — Worker thin-agent.** Repurpose the shell: poll `pc_jobs`; X4/XTEINK
transfer (read snapshot + epubs from R2, build tree, catalog — §12.5); local
backup pull. Keep heartbeat/tray/config (Calibre/FFF removed).

**Phase I — Mobile + sunset.** Bookmarklet capture fallback; retire Calibre from
the pipeline after verification (stays installed as break-glass).
