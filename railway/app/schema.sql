-- StoryHub Railway hub — Postgres schema.
-- Source of truth: docs/data-model.md §6.3.
-- Idempotent: safe to run on every startup (CREATE ... IF NOT EXISTS).
--
-- Conventions:
--   * Surrogate ids are uuid (gen_random_uuid(), built into Postgres 13+).
--   * Status/enum-ish fields are text + CHECK constraints rather than native
--     enums, so adding a value later is a plain migration, not an ALTER TYPE.
--   * created_at/updated_at default to now() (UTC on Railway Postgres).

-- ---------------------------------------------------------------------------
-- queue_items — extension/bookmarklet adds a story; worker drains it.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS queue_items (
    id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id              text NOT NULL,
    status               text NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','fetching','importing',
                                              'reviewing','done','failed')),
    metadata_json        jsonb,
    epub_r2_path         text,
    source               text,
    calibre_id_assigned  integer,
    review_payload       jsonb,
    error_message        text,
    created_at           timestamptz NOT NULL DEFAULT now(),
    updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS queue_items_status_idx   ON queue_items (status, created_at);
CREATE INDEX IF NOT EXISTS queue_items_work_id_idx  ON queue_items (work_id);

-- ---------------------------------------------------------------------------
-- status_updates — read-status change from dashboard or extension hooks.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS status_updates (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id     text,
    calibre_id  integer,
    new_status  text NOT NULL
                  CHECK (new_status IN ('Unread','Priority','Read','Favorite','DNF')),
    old_status  text,
    source      text,
    created_at  timestamptz NOT NULL DEFAULT now(),
    applied_at  timestamptz
);
CREATE INDEX IF NOT EXISTS status_updates_pending_idx
    ON status_updates (created_at) WHERE applied_at IS NULL;

-- ---------------------------------------------------------------------------
-- snapshot_versions — pointer to the current library snapshot in R2.
-- version is the client cache-invalidation key (HARD RULE: bump on format change).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS snapshot_versions (
    version     integer PRIMARY KEY,
    r2_path     text NOT NULL,
    book_count  integer,
    created_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- ao3_actions — worker enqueues, extension performs (bookmark / mark-read).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS ao3_actions (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id           text NOT NULL,
    action            text NOT NULL CHECK (action IN ('bookmark','mark_read')),
    status            text NOT NULL DEFAULT 'pending'
                        CHECK (status IN ('pending','done')),
    status_update_id  uuid REFERENCES status_updates (id) ON DELETE SET NULL,
    created_at        timestamptz NOT NULL DEFAULT now(),
    completed_at      timestamptz
);
CREATE INDEX IF NOT EXISTS ao3_actions_pending_idx
    ON ao3_actions (created_at) WHERE status = 'pending';

-- ---------------------------------------------------------------------------
-- worker_heartbeats — one row per worker; liveness + recent log tail.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS worker_heartbeats (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    worker_id         text NOT NULL UNIQUE,
    last_seen_at      timestamptz NOT NULL DEFAULT now(),
    recent_log_lines  jsonb
);

-- ---------------------------------------------------------------------------
-- reading_lists / members — manual + built-in system lists (Phase 6 UI).
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS reading_lists (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    name             text NOT NULL,
    description      text,
    color            text,
    cover_image_url  text,
    auto_pin         boolean NOT NULL DEFAULT false,
    is_system        boolean NOT NULL DEFAULT false,
    membership_rule  text,
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS reading_list_members (
    reading_list_id  uuid NOT NULL REFERENCES reading_lists (id) ON DELETE CASCADE,
    calibre_id       integer NOT NULL,
    position         integer,
    added_at         timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (reading_list_id, calibre_id)
);

-- ---------------------------------------------------------------------------
-- per_story_pins — device-cache pin, independent of reading-list auto-pin.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS per_story_pins (
    calibre_id  integer PRIMARY KEY,
    pinned      boolean NOT NULL DEFAULT false,
    updated_at  timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- saved_filters — saved Browse filter/sort state (Phase 6 UI).
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

-- ---------------------------------------------------------------------------
-- tag_states — curated-category tag state (Phase 6/7). Structural categories
-- (Fandom/Relationship/Character/Rating) are NOT stored here — see §6.3.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS tag_states (
    tag              text PRIMARY KEY,
    state            text NOT NULL DEFAULT 'normal'
                        CHECK (state IN ('favorite','normal','excluded')),
    category         text,
    auto_classified  boolean NOT NULL DEFAULT false,
    updated_at       timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- settings — single-row-per-key config blob for the user.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS settings (
    key         text PRIMARY KEY,
    value_json  jsonb,
    updated_at  timestamptz NOT NULL DEFAULT now()
);
