# Reading

> Source: §7.4 of the original StoryHub design doc.

[DECIDED]

Tap-to-read behavior is **per-device configurable**, stored in the device's
IndexedDB (not synced via Railway — the right mode genuinely differs across
devices).

## Two modes available in v1

| Mode | Tap-to-read behavior |
|---|---|
| **Open on AO3** | Open a new tab/window pointing at `https://archiveofourown.org/works/{work_id}` |
| **Open EPUB (pinned-aware)** | If story is in the device's CacheStorage (via per-story pin or membership in an auto-pinned Reading List), open the cached copy — fully offline-capable. Otherwise download from R2 (`/epubs/{calibre_id}.epub`), then open. The PWA's service worker intercepts the request and resolves cache-first. |

## Default per device

On first PWA launch on a device, StoryHub heuristically suggests a default
based on user-agent:
- E-ink devices and known mobile readers → EPUB mode
- Desktop / tablet browsers → AO3 mode

User can override at any time via Settings (per-device).

## Why per-device

- On the Palma, EPUB mode is the entire point of the device — read offline, paged display, no AO3 round-trip.
- On PC or iPad, AO3 mode keeps the user in a single browser surface with nicer typography than Calibre's viewer. On PC with the extension active, the whole reading-and-status-update loop happens on AO3 — every Mark-for-Later toggle, bookmark save, and DNF-button click flows back through the extension to StoryHub automatically.

**iPad caveat:** Safari doesn't run the StoryHub extension, so
reading-on-AO3-via-iPad means status changes have to be made manually in the
StoryHub dashboard later (or when back on PC/Palma). Acceptable v1 tradeoff.

## Per-story override

Not in v1. If it becomes annoying, a long-press / right-click menu with "Open
the other way" is a clean later add.

## In-browser EPUB reader (cross-device position sync) [DEFERRED to v2]

Real, feasible, but adds real work (epub.js or similar, Railway state for
reading position, cross-tab sync). See
[../v2-deferred/in-browser-reader.md](../v2-deferred/in-browser-reader.md).
