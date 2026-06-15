"""StoryHub local worker.

Phase 1 is a *shell*: it heartbeats to Railway, drains the pending queue, and
acks each item as `done` without doing any actual work (no Calibre, no R2).
Real processing — Calibre REST add, normalization, R2, FanFicFare, X4 — lands
in Phase 2. See docs/components/worker.md and docs/build-phases.md.
"""

__version__ = "0.1.0"
