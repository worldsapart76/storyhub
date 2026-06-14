# Sync view

> Source: §7.10 of the original StoryHub design doc.

[DECIDED]

Worker status + recent activity:

- Worker online indicator (green/amber/red based on heartbeat age)
- Queue summary: N pending, N processing, N failed (with retry buttons)
- Recent activity log (last 50 events): imports, status updates, snapshot pushes, errors
- Manual triggers:
  - "Sync X4" — runs SD card transfer if card mounted (see [../lifted-from-fff/xteink-transfer.md](../lifted-from-fff/xteink-transfer.md))
  - "Run FanFicFare update check" — kicks off scheduled job manually
  - "Re-upload library to R2" — for after R2 wipe
  - "Refresh snapshot" — forces snapshot rebuild
- Last sync timestamps for each major operation

The worker heartbeats every ~30s; the indicator color is derived from
`time_since_last_heartbeat`. See [../components/worker.md](../components/worker.md).
