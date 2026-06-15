-- Dev helper: clear all library/operational DATA but keep the schema + settings.
-- Used during Phase D iteration (wipe-and-reload from the migration cache).
-- Idempotent; CASCADE + RESTART IDENTITY resets the serial ids too.
TRUNCATE works, authors, work_authors, tags, work_tags, tag_groups,
  tag_group_members, categories, reading_lists, reading_list_members,
  saved_filters, queue_items, ao3_actions, pc_jobs, worker_heartbeats,
  snapshot_versions
  RESTART IDENTITY CASCADE;
