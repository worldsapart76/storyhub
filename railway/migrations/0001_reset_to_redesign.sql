-- One-time teardown of the Calibre-era schema before the redesign schema first
-- boots. Apply ONCE against the live DB, then app/schema.sql (idempotent forward
-- CREATEs, auto-run by db.py on startup) builds the redesign tables.
--
-- Safe because the clean-rebuild decision (2026-06-15) confirmed the live DB is
-- an empty Phase-1 scaffold with no real library data. DO NOT re-run once the
-- redesign tables hold data — it is destructive by design.
--
-- Drops cover:
--   * Eliminated tables: status_updates, tag_states, per_story_pins.
--   * Reshaped tables (recreated by schema.sql in their §6/§12 form):
--     queue_items, ao3_actions, reading_list_members, reading_lists,
--     saved_filters, snapshot_versions, worker_heartbeats.
-- CASCADE handles the old FK from ao3_actions -> status_updates.

BEGIN;

DROP TABLE IF EXISTS status_updates       CASCADE;
DROP TABLE IF EXISTS tag_states           CASCADE;
DROP TABLE IF EXISTS per_story_pins        CASCADE;
DROP TABLE IF EXISTS ao3_actions          CASCADE;
DROP TABLE IF EXISTS queue_items          CASCADE;
DROP TABLE IF EXISTS reading_list_members CASCADE;
DROP TABLE IF EXISTS reading_lists        CASCADE;
DROP TABLE IF EXISTS saved_filters        CASCADE;
DROP TABLE IF EXISTS snapshot_versions    CASCADE;
DROP TABLE IF EXISTS worker_heartbeats    CASCADE;

COMMIT;
