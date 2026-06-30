-- 0004 — pc_jobs queue (Phase H worker thin-agent, redesign §12.4). The two
-- PC-bound jobs the dashboard triggers and the Windows worker runs: X4 SD-card
-- transfer + local backup pull. Dashboard enqueues → worker claims the oldest
-- pending job (one at a time) → runs it → reports status + log → dashboard shows
-- the result. Distinct from `pending_changes` (library/AO3 sync) and the legacy
-- `queue_items` (capture import) — this is machine-local work, not data stewardship.

CREATE TABLE IF NOT EXISTS pc_jobs (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    job_type     text NOT NULL CHECK (job_type IN ('x4_transfer','backup_pull')),
    params       jsonb NOT NULL DEFAULT '{}'::jsonb,  -- e.g. {expected_snapshot_version: N}
    status       text NOT NULL DEFAULT 'pending'
                     CHECK (status IN ('pending','running','done','failed')),
    log          text,                  -- progress + final report (updated as it runs)
    worker_id    text,                  -- which worker claimed it (NULL until claimed)
    created_at   timestamptz NOT NULL DEFAULT now(),
    started_at   timestamptz,
    finished_at  timestamptz
);

-- `worker_id` isn't in the original §12.4 sketch; add it idempotently so a DB that
-- already had a bare pc_jobs table (CREATE TABLE IF NOT EXISTS = no-op there) still
-- gets the column.
ALTER TABLE pc_jobs ADD COLUMN IF NOT EXISTS worker_id text;

-- Worker claim path: oldest pending job first.
CREATE INDEX IF NOT EXISTS pc_jobs_pending_idx
    ON pc_jobs (created_at) WHERE status = 'pending';
-- Dashboard list: newest first.
CREATE INDEX IF NOT EXISTS pc_jobs_recent_idx ON pc_jobs (created_at DESC);
