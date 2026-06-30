-- 0003 — unified pending-changes queue (pending-queue redesign, supersedes §12.2
-- auto-drain + optimistic writes). One row per user action from either surface;
-- nothing is applied until the user hits Apply on that surface. Two independent
-- side-states (AO3 / library) let the same item be committed to each surface
-- separately. Denormalized title/author so the queue renders captures (not yet in
-- `works`) without a join.

CREATE TABLE IF NOT EXISTS pending_changes (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    work_id         bigint NOT NULL,
    action          text NOT NULL CHECK (action IN
                        ('capture','mark_read','mark_unread','mark_dnf',
                         'favorite','unfavorite')),
    title           text,            -- snapshotted at queue time (display)
    author          text,            -- snapshotted at queue time (display)
    payload         jsonb NOT NULL DEFAULT '{}'::jsonb,  -- capture metadata / proposals
    staging_key     text,            -- held epub in R2 (captures); deleted on cancel
    ao3_state       text NOT NULL DEFAULT 'pending'
                        CHECK (ao3_state IN ('pending','done','na')),
    library_state   text NOT NULL DEFAULT 'pending'
                        CHECK (library_state IN ('pending','done','na')),
    origin          text NOT NULL CHECK (origin IN ('ao3','pwa')),
    error           text,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

-- "open" items = at least one side still pending (what the queue views list).
CREATE INDEX IF NOT EXISTS pending_changes_open_idx
    ON pending_changes (library_state, ao3_state, created_at);
CREATE INDEX IF NOT EXISTS pending_changes_work_idx ON pending_changes (work_id);
