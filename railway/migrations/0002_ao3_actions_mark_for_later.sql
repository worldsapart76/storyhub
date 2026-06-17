-- 0002 — add 'mark_for_later' to the ao3_actions action CHECK (redesign §12.2,
-- the Unread re-mark amended 2026-06-16). The live table was created in Phase A
-- before mark_for_later was added to schema.sql, so its CHECK lacks it; this
-- aligns it. Idempotent: drop-if-exists then re-add the full set.
ALTER TABLE ao3_actions DROP CONSTRAINT IF EXISTS ao3_actions_action_check;
ALTER TABLE ao3_actions ADD CONSTRAINT ao3_actions_action_check
    CHECK (action IN ('mark_read', 'mark_for_later', 'bookmark', 'remove_bookmark'));
