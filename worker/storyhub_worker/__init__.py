"""StoryHub local worker — a thin Windows agent (redesign §12.4).

Heartbeats to Railway and runs the two PC-bound `pc_jobs`: X4 SD-card transfer and
local backup pull. No Calibre, no FanFicFare, no normalization — all of that is
server-side; the worker only reads the snapshot + epubs from R2 and moves files.
See docs/calibre-removal-redesign.md §12.4–12.5.
"""

__version__ = "0.2.0"
