# worker/

Python (3.12) Windows tray service. Drives Calibre (Content Server REST), R2,
FanFicFare (update-checks only), and X4 SD-card transfer + catalog generation.

**No code yet** — scaffold stage. First code lands in Phase 1 (heartbeat +
queue poll), with the Calibre integration and the FFF code lift in Phase 2.

Spec: [../docs/components/worker.md](../docs/components/worker.md).
Lifted FFF modules will live under `normalize/`, `sync/`, `export/`, `data/` —
see [../docs/open-questions.md](../docs/open-questions.md) for the lift table
and [../docs/lifted-from-fff/](../docs/lifted-from-fff/) for behavior.
