-- 0005 — backfill date_read for existing DNF works.
--
-- DNF used to set only read_status + updated_at, never date_read, so pre-existing
-- DNFs are undated. Going forward mark_dnf stamps date_read=now() (pending.py); a
-- DNF is "read enough to bail" and analytics keys "completed = no longer Unread"
-- off date_read. Best-effort backfill: use updated_at as the completion proxy
-- (the last write to a still-DNF row is, in practice, the DNF write). This is an
-- APPROXIMATION for rows touched after the DNF — acceptable for a few-days-old
-- library; no silent caps (the SELECT below reports the count it changed).
-- Idempotent: only fills NULLs, so re-running is a no-op.
UPDATE works
   SET date_read = updated_at
 WHERE read_status = 'DNF'
   AND date_read IS NULL;

-- Report what was backfilled (run_migration.py prints table list, not row counts;
-- this leaves a visible NOTICE in the migration output).
DO $$
DECLARE remaining int;
BEGIN
  SELECT count(*) INTO remaining
    FROM works WHERE read_status = 'DNF' AND date_read IS NULL;
  RAISE NOTICE 'DNF works still undated after backfill: %', remaining;
END $$;
