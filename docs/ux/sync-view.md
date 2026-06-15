# Sync view

> Source: §7.10 of the original StoryHub design doc.
> **Reconciled to the Calibre-removal redesign §12.4–12.5 (Phase P, 2026-06-14).**
> The redesign wins on conflict: the worker is a **thin agent** (X4 transfer +
> backup pull only), there is **no FanFicFare** (removed — hard rule), and
> snapshot/R2 are **server** operations, not worker jobs.

[DECIDED]

Worker status + recent activity:

- Worker online indicator (green/amber/red based on heartbeat age)
- Queue summary: N pending, N running, N failed (with retry buttons) — the
  `pc_jobs` queue (§12.4)
- Recent activity log: captures/commits, status & favorite changes (derived from
  `updated_at` / `date_read` — there is no `status_updates` table, §12.2),
  snapshot rebuilds, transfers, backups, errors
- Manual triggers, **split by scope**:
  - **Worker triggers — gated by the heartbeat** (disabled when the worker isn't
    Online), enqueued as `pc_jobs`:
    - "Sync X4" — `x4_transfer`; runs the SD-card transfer if the card is mounted
      (see [../lifted-from-fff/xteink-transfer.md](../lifted-from-fff/xteink-transfer.md))
    - "Backup pull" — `backup_pull`; pulls the local backup
  - **Server triggers — Railway-side, always available** (not worker jobs):
    - "Refresh snapshot" — forces a snapshot rebuild (§12.3)
    - "Re-upload to R2" — re-uploads epubs, e.g. after an R2 wipe
- Last sync timestamp + status per trigger

**Removed from the Calibre-era spec:** "Run FanFicFare update check" — FanFicFare
is gone entirely (no first-fetch, no update detection; only complete works are
ever added — hard rule).

The worker heartbeats every ~30s; the indicator color is derived from
`time_since_last_heartbeat`. See redesign §12.4 (the worker contract supersedes
the Calibre-era [../components/worker.md](../components/worker.md)).
