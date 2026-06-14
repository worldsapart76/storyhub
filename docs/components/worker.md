# Local worker

> Source: §4.5 of the original StoryHub design doc.

[DECIDED]

Python service, no GUI, runs as a Windows tray app (autostart on login).
Windows only.

## Responsibilities

- Long-poll Railway for queue items
- Download staged epubs from R2
- Write epubs to Calibre watch dir / call Calibre add via REST
- Run ship + collection normalization (Rules 1–5, lifted from FFF `normalize/` — see [../lifted-from-fff/normalization-rules.md](../lifted-from-fff/normalization-rules.md))
- Decide auto-resolve vs review-needed per story
- Pull confirmed reviews from Railway and write metadata
- Drain status-update queue, write `#readstatus` + `#date_read` to Calibre
- Enqueue AO3 actions for status updates whose source requires them
- Export library snapshot after any Calibre write, upload to R2, bump version
- Upload epubs to R2 (one-time backfill for existing library, ongoing per new import)
- Periodic FanFicFare update check on existing books (scheduled) — see [../lifted-from-fff/fanficfare-integration.md](../lifted-from-fff/fanficfare-integration.md)
- SD card transfer + catalog generation for X4 (triggered from dashboard) — see [../lifted-from-fff/xteink-transfer.md](../lifted-from-fff/xteink-transfer.md) and [../lifted-from-fff/xteink-catalog.md](../lifted-from-fff/xteink-catalog.md)
- Heartbeat to Railway every ~30s
- Log to local file + post recent events to Railway for dashboard display

## Communication

- **Outbound:** Railway REST, R2 S3 API, Calibre content server REST, optional ADB for fallback
- **Inbound:** localhost API for direct extension calls (when extension is on same PC) and dashboard development

## Runtime files

Under `~/.storyhub/` — `settings.json`, `worker.log`, etc.

## Hard rules

- No `calibredb` CLI — REST end-to-end. See [../lifted-from-fff/calibre-quirks.md](../lifted-from-fff/calibre-quirks.md).
- No FanFicFare for first-fetch — that's the extension's job. FanFicFare is for chapter-update detection on already-imported stories only.
- Don't write `#readstatus` to a book that already had a status (only fresh imports get it).
- Don't sync `"Unread"` from any source — device default, not a deliberate state.
- No silent caps — log what was dropped.

## [OPEN] concurrency

How many queue items processed in parallel? Likely 1–3. Tune during Phase 1.
