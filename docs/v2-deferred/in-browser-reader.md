# In-browser EPUB reader (cross-device position sync) [DEFERRED to v2]

> Placeholder for v2 design. Referenced from [../ux/reading.md](../ux/reading.md)
> (§7.4) and [../open-questions.md](../open-questions.md).

## Intent

An EPUB reader rendered inside the PWA itself, so reading happens in StoryHub
without a round-trip to AO3 or an external reader app — with **reading position
synced across devices** (start on the Palma, continue on the PC).

## Why deferred

Real and feasible, but adds real work:
- An in-browser EPUB rendering engine (epub.js or similar)
- Railway state for reading position per story per user
- Cross-tab / cross-device sync of that position

Revisit once v1 is in daily use and we know whether it's actually wanted. The
v1 reading model (per-device open mode: Open on AO3 vs Open EPUB pinned-aware —
the latter just hands the epub to the device's native handler) covers the core
need without this.

## Open design questions (for the v2 pass)

- Rendering library choice and its offline behavior inside the service worker
- Position model: CFI vs percentage; conflict resolution when two devices read offline then sync
- Whether position sync rides the existing snapshot/Railway plumbing or needs its own low-latency channel
- Interaction with the existing CacheStorage epub pinning
