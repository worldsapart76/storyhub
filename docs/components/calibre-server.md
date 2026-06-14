# Calibre content server

> Source: §4.6 of the original StoryHub design doc. See also
> [../lifted-from-fff/calibre-quirks.md](../lifted-from-fff/calibre-quirks.md)
> for REST patterns and gotchas.

[DECIDED]

Standard `calibre-server.exe` running as a Windows service. Listens on
localhost (also reachable on LAN at the host's local IP, `192.168.4.158:8080`).
Worker hits its REST API for all library reads/writes. **Replaces `calibredb`
CLI subprocess calls.**

Benefits: removes the "Calibre GUI must be closed" constraint (verified
2026-06-13 — concurrent reads work with the GUI open), supports concurrent
reads, faster.

## Implementation notes for the worker

- REST endpoint base: `http://localhost:8080/ajax/...`
- Library identifier: `FanFiction` (one of two on this host; default library; the other is `Calibre-Commercial`, untouched)
- Custom columns are returned in `user_metadata` with **`#` prefix natively** — no `*` → `#` translation needed (unlike `calibredb list` output, which the old `calibre.py` had to normalize)
- Custom column value is at `user_metadata['#colname']['#value#']`
- Datatypes verified: `#date_read` is `datetime`, `#wordcount` is `int`, the rest are `text`

## Exposure / auth

Server stays bound to the local network only. No public exposure required by
any flow in this design — the worker is local, the snapshot lives on R2 for
external consumers, and Railway never connects back to Calibre. Auth is
therefore left off (current state). If exposure ever becomes a need, turn on
Calibre's username/password and update the worker config.

## Operational note

Adding/changing columns in Calibre Preferences requires the user to **OK out of
the Preferences dialog AND restart the Calibre GUI** (not just the content
server). This confused us once during Phase 0.

## Custom columns

See [../data-model.md §6.1](../data-model.md) for the full column list. All
verified present on the `FanFiction` library as of 2026-06-13.
