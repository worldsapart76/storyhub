-- 0006 — per-story personal notes.
--
-- Freeform private note the user writes on a work (who recommended it, why they
-- want to read it, what they liked). Written only via PATCH /api/works/{id}
-- (deliberate user action); never set by import/commit. Projected into the
-- snapshot work_cards (FORMAT_VERSION bumped 2 -> 3) so the PWA story card can
-- show it. Idempotent.
ALTER TABLE works ADD COLUMN IF NOT EXISTS personal_notes text;
