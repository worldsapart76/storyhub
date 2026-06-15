# worker/

Python (3.12) Windows tray service. Drives Calibre (Content Server REST), R2,
FanFicFare (update-checks only), and X4 SD-card transfer + catalog generation.

**Phase 1 (current): shell.** Heartbeats to Railway every ~30s, drains the
pending queue, and acks each item as `done` *without doing any work* (no
Calibre, no R2). This proves the round-trip and the liveness path. The Calibre
integration and the FFF code lift land in Phase 2.

Spec: [../docs/components/worker.md](../docs/components/worker.md).
Lifted FFF modules will live under `normalize/`, `sync/`, `export/`, `data/` —
see [../docs/open-questions.md](../docs/open-questions.md) for the lift table
and [../docs/lifted-from-fff/](../docs/lifted-from-fff/) for behavior.

## Layout (Phase 1)

```
storyhub_worker/
  __main__.py        `python -m storyhub_worker` entry
  cli.py             argparse subcommands (tray / run / config / *-autostart)
  config.py          ~/.storyhub/settings.json load/save + defaults
  logging_setup.py   rotating worker.log + ring buffer for heartbeat lines
  api.py             Railway REST client (httpx): heartbeat, drain, ack
  engine.py          the heartbeat + queue-drain loop (threaded)
  tray.py            pystray tray app wrapping the engine
  autostart.py       HKCU Run-key install/uninstall
```

## Setup

```
python -m venv .venv
.venv/Scripts/python -m pip install -r requirements.txt
```

First run writes a template `~/.storyhub/settings.json`. Edit it to set
`railway_url` (the Railway public domain) and `auth_token` (the shared
`AUTH_TOKEN`, see [../docs/auth.md](../docs/auth.md)). `worker_id` defaults to
the machine hostname.

## Running

```
.venv/Scripts/python -m storyhub_worker            # tray app (default)
.venv/Scripts/python -m storyhub_worker run        # headless (Ctrl-C to stop)
.venv/Scripts/python -m storyhub_worker config     # show settings + autostart
.venv/Scripts/python -m storyhub_worker install-autostart    # start at login
.venv/Scripts/python -m storyhub_worker uninstall-autostart
```

Logs go to `~/.storyhub/worker.log` (rotating) and the console. Configure the
worker before installing autostart — when launched at login via `pythonw` there
is no console to show the "not configured" message.

## Verifying the round-trip

With the Railway service running and `settings.json` pointed at it:

1. Start the worker (`run` is easiest for watching logs).
2. Enqueue an item — `POST /api/queue` with `{"work_id": "test"}` and the
   `Authorization: Bearer` header.
3. The worker logs `drained 1 queue item(s)`; `GET /api/queue?status=done`
   shows it, and `GET /api/worker/status` shows this worker `alive`.
