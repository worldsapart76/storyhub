-- StoryHub Railway hub — Postgres schema.
-- Source of truth: docs/calibre-removal-redesign.md §6 (data model) + §12
-- (operational tables). This REPLACES the Calibre-era schema (data-model.md §6.3).
--
-- Idempotent forward schema: safe to run on every startup (CREATE ... IF NOT
-- EXISTS), which db.py does. The one-time teardown of the old Calibre-era tables
-- lives in migrations/0001_reset_to_redesign.sql — apply it ONCE before this
-- schema first boots on the live DB (the clean-rebuild decision, 2026-06-15).
--
-- Conventions:
--   * work_id is the AO3 work id verbatim (pos) / pre-AO3 local id (neg). It is
--     the natural PK for works; everything else FKs to it. (redesign §2)
--   * Other surrogate ids: uuid for queue/action/list rows; bigint IDENTITY for
--     internal entity ids (authors, tags, tag_groups, categories).
--   * Enum-ish fields are text + CHECK rather than native enums, so adding a
--     value later is a plain migration, not an ALTER TYPE. (carried convention)
--   * created_at/updated_at default to now() (UTC on Railway Postgres).
--
-- THREE doc-ambiguity resolutions are marked [RESOLVED …] inline — see the
-- chunk review notes. Push back there if any is wrong.

-- ===========================================================================
-- CORE ENTITIES (redesign §6.1–6.3.1)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- categories — the ordered category SET for freeform/warning tags (§12.6).
-- Created before `tags` because tags.category references it by name.
-- The single global lock lives in settings (key 'lock_category_list').
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name           text NOT NULL UNIQUE,
    display_order  integer
);

-- ---------------------------------------------------------------------------
-- works — the central entity (fanfiction; potentially books). (§6.1)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS works (
    work_id           bigint PRIMARY KEY,           -- pos = AO3 id, neg = pre-AO3
    source            text NOT NULL DEFAULT 'ao3'
                        CHECK (source IN ('ao3','pre_ao3','other')),
    work_type         text NOT NULL DEFAULT 'fanfiction'
                        CHECK (work_type IN ('fanfiction','book')),
    source_url        text,
    title             text NOT NULL,
    summary_html      text,
    short_summary     text,                          -- catalog
    wordcount         integer,
    chapter_count     integer,                       -- informational only
    is_complete       boolean,                       -- informational only
    language          text,
    series_name       text,
    series_index      numeric,
    rating            text
                        CHECK (rating IN ('Explicit','Mature','Teen',
                                          'General','Not Rated')),
    read_status       text NOT NULL DEFAULT 'Unread'
                        CHECK (read_status IN ('Unread','Read','DNF')),
    is_favorite       boolean NOT NULL DEFAULT false,
    pinned            boolean NOT NULL DEFAULT false, -- [RESOLVED #3] see notes
    date_read         timestamptz,
    date_added        timestamptz,
    availability      text NOT NULL DEFAULT 'live'
                        CHECK (availability IN ('live','deleted','locked','n/a')),
    last_seen_on_ao3  timestamptz,
    epub_r2_key       text,
    epub_hash         text,
    cover_r2_key      text,                          -- future non-fic only
    created_at        timestamptz NOT NULL DEFAULT now(),
    updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS works_read_status_idx ON works (read_status);
CREATE INDEX IF NOT EXISTS works_is_favorite_idx ON works (is_favorite) WHERE is_favorite;
CREATE INDEX IF NOT EXISTS works_date_added_idx  ON works (date_added DESC);

-- ---------------------------------------------------------------------------
-- authors / work_authors — join table, preserves byline order. (§6.2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS authors (
    author_id  bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name       text NOT NULL UNIQUE                 -- AO3 pseud / byline name
);

CREATE TABLE IF NOT EXISTS work_authors (
    work_id    bigint NOT NULL REFERENCES works (work_id) ON DELETE CASCADE,
    author_id  bigint NOT NULL REFERENCES authors (author_id) ON DELETE CASCADE,
    position   integer,                              -- byline order; co-creators
    PRIMARY KEY (work_id, author_id)
);
CREATE INDEX IF NOT EXISTS work_authors_author_idx ON work_authors (author_id);

-- ---------------------------------------------------------------------------
-- tags — first-class (replaces #all_* JSON columns AND tag_states). (§6.3)
--
-- [RESOLVED #1] Synonym/canonical equivalence is stored as a self-reference
-- here (canonical_tag_id), NOT as a tag_groups row. This follows the 2026-06-14
-- refinement to §6.3.1 ("a ship's spelling variants are just synonyms of the
-- canonical relationship tag — no group object is required for ships"). A
-- synonym row sets canonical_tag_id -> its canonical; a canonical (or a plain
-- ungrouped tag) leaves it NULL. "At most one synonym per tag" is then trivially
-- enforced by the single column. tag_groups is left to roll-ups only (below).
-- The "domain" gate (synonyms only share a category, or a kind when category is
-- NULL) is enforced in Tag Management (app-side), not by a DB constraint.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tags (
    tag_id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             text NOT NULL,                  -- raw AO3 tag text
    display_name     text,                           -- optional display alias
    kind             text NOT NULL
                        CHECK (kind IN ('fandom','relationship','character',
                                        'freeform','warning')),
    category         text REFERENCES categories (name)   -- [RESOLVED #2] see notes
                        ON UPDATE CASCADE ON DELETE SET NULL,
    canonical_tag_id bigint REFERENCES tags (tag_id) ON DELETE SET NULL,
    state            text NOT NULL DEFAULT 'normal'
                        CHECK (state IN ('favorite','normal','excluded')),
    auto_classified  boolean NOT NULL DEFAULT false,
    updated_at       timestamptz NOT NULL DEFAULT now(),
    UNIQUE (name, kind)
);
CREATE INDEX IF NOT EXISTS tags_kind_idx       ON tags (kind);
CREATE INDEX IF NOT EXISTS tags_category_idx   ON tags (category);
CREATE INDEX IF NOT EXISTS tags_canonical_idx  ON tags (canonical_tag_id)
    WHERE canonical_tag_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- work_tags — a work's tags, with AO3 order + the two primary-role flags.
-- Exactly one primary per axis per work (partial unique indexes). (§6.3)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS work_tags (
    work_id                bigint NOT NULL REFERENCES works (work_id) ON DELETE CASCADE,
    tag_id                 bigint NOT NULL REFERENCES tags (tag_id) ON DELETE CASCADE,
    position               integer,                 -- AO3 per-work order (per kind)
    is_primary_ship        boolean NOT NULL DEFAULT false,
    is_primary_collection  boolean NOT NULL DEFAULT false,
    PRIMARY KEY (work_id, tag_id)
);
CREATE INDEX IF NOT EXISTS work_tags_tag_idx ON work_tags (tag_id);
CREATE UNIQUE INDEX IF NOT EXISTS work_tags_one_primary_ship_idx
    ON work_tags (work_id) WHERE is_primary_ship;
CREATE UNIQUE INDEX IF NOT EXISTS work_tags_one_primary_collection_idx
    ON work_tags (work_id) WHERE is_primary_collection;

-- ---------------------------------------------------------------------------
-- tag_groups / tag_group_members — roll-up layer ONLY (collection/property).
-- (§6.3.1 refinement: equivalence/synonym/ship moved to tags.canonical_tag_id
-- above, so group_type here is restricted to the two roll-up semantics. The
-- group's class is inferred from member kind at creation; stored for query
-- ergonomics. parent_group_id is RESERVED + dormant in v1 — do not traverse.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tag_groups (
    group_id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    name             text NOT NULL,                  -- display/canonical name
    group_type       text NOT NULL
                        CHECK (group_type IN ('collection','property')),
    canonical_tag_id bigint REFERENCES tags (tag_id) ON DELETE SET NULL,
    parent_group_id  bigint REFERENCES tag_groups (group_id) ON DELETE SET NULL,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tag_group_members (
    group_id  bigint NOT NULL REFERENCES tag_groups (group_id) ON DELETE CASCADE,
    tag_id    bigint NOT NULL REFERENCES tags (tag_id) ON DELETE CASCADE,
    PRIMARY KEY (group_id, tag_id)
);
CREATE INDEX IF NOT EXISTS tag_group_members_tag_idx ON tag_group_members (tag_id);

-- ===========================================================================
-- READING LISTS & SAVED FILTERS (redesign §6.4, §6.5)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- reading_lists / members — manual + system ("playlist") lists. (§6.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_lists (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name                 text NOT NULL,
    description          text,
    color                text,
    cover_image_r2_key   text,                       -- 200x200 upload (only crop)
    auto_pin             boolean NOT NULL DEFAULT false,
    is_system            boolean NOT NULL DEFAULT false,
    membership_rule      text,                       -- e.g. 'is_favorite = true'
    display_order        integer,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reading_list_members (
    reading_list_id  uuid NOT NULL REFERENCES reading_lists (id) ON DELETE CASCADE,
    work_id          bigint NOT NULL REFERENCES works (work_id) ON DELETE CASCADE,
    position         integer,
    added_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (reading_list_id, work_id)
);

-- ---------------------------------------------------------------------------
-- saved_filters — saved Browse filter/sort state (§6.5, shape unchanged).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS saved_filters (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name               text NOT NULL,
    filter_state_json  jsonb,
    sort_state_json    jsonb,
    starred            boolean NOT NULL DEFAULT false,
    display_order      integer,
    created_at         timestamptz NOT NULL DEFAULT now(),
    updated_at         timestamptz NOT NULL DEFAULT now()
);

-- ===========================================================================
-- OPERATIONAL TABLES (redesign §12)
-- ===========================================================================

-- ---------------------------------------------------------------------------
-- queue_items — import queue. Extension POSTs raw metadata; Railway normalizes
-- server-side, then auto-commits or routes to the per-work Review Queue. (§12.1)
-- (No calibre_id_assigned — nothing external assigns an id.)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_items (
    queue_item_id  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id        bigint NOT NULL,                  -- AO3 id, known at capture
    source         text NOT NULL DEFAULT 'ao3'
                     CHECK (source IN ('ao3','manual','bookmarklet')),
    raw_metadata   jsonb,                            -- raw payload, verbatim
    staging_key    text,                             -- /staging/{queue_item_id}.epub
    state          text NOT NULL DEFAULT 'pending'
                     CHECK (state IN ('pending','normalized','auto_committed',
                                      'needs_review','committed','failed')),
    proposals      jsonb,                            -- normalization output
    error          text,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_items_state_idx   ON queue_items (state, created_at);
CREATE INDEX IF NOT EXISTS queue_items_work_id_idx ON queue_items (work_id);

-- ---------------------------------------------------------------------------
-- ao3_actions — the one real queue: app enqueues AO3 side-effects, the
-- extension drains them on the next AO3 page load. (§12.2)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ao3_actions (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id     bigint NOT NULL REFERENCES works (work_id) ON DELETE CASCADE,
    action      text NOT NULL
                  CHECK (action IN ('mark_read','bookmark','remove_bookmark')),
    params      jsonb,                               -- {private: true} for bookmark
    status      text NOT NULL DEFAULT 'pending'
                  CHECK (status IN ('pending','done','failed')),
    created_at  timestamptz NOT NULL DEFAULT now(),
    done_at     timestamptz
);
CREATE INDEX IF NOT EXISTS ao3_actions_pending_idx
    ON ao3_actions (created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- pc_jobs — dashboard-triggered jobs for the thin worker (X4 / backup). (§12.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS pc_jobs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type     text NOT NULL CHECK (job_type IN ('x4_transfer','backup_pull')),
    params       jsonb,                              -- {expected_snapshot_version: N}
    status       text NOT NULL DEFAULT 'pending'
                   CHECK (status IN ('pending','running','done','failed')),
    log          text,
    created_at   timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz
);
CREATE INDEX IF NOT EXISTS pc_jobs_pending_idx
    ON pc_jobs (created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- worker_heartbeats — one row per worker; liveness + recent log tail. (§12.4)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id         text NOT NULL UNIQUE,
    last_seen_at      timestamptz NOT NULL DEFAULT now(),
    recent_log_lines  jsonb
);

-- ---------------------------------------------------------------------------
-- snapshot_versions — pointer to the current R2 snapshot. (§12.3)
-- TWO version concepts: `version` = CONTENT version (bumps on any committed data
-- change; clients re-download when it differs). `format_version` = the snapshot
-- SCHEMA shape (bumps only on a projection code change — the CLAUDE.md hard
-- rule; lets clients invalidate a structurally-incompatible cache).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshot_versions (
    version         integer PRIMARY KEY,            -- content version
    format_version  integer NOT NULL DEFAULT 1,     -- structure version
    r2_path         text NOT NULL,
    work_count      integer,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- settings — single-row-per-key config blob (e.g. lock_category_list). (§12.6)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key         text PRIMARY KEY,
    value_json  jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
