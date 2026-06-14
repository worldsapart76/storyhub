# Settings view

> Source: §7.11 of the original StoryHub design doc.

[DECIDED on shape]

Top-level settings sections:

## Connection

- Auth token (set on first setup, masked after)
- Calibre content server URL (default `http://localhost:8080`)
- R2 / Railway credentials (set once, masked)
- "Test connection" buttons per endpoint

## Tag Management [DECIDED]

- Table showing every tag in the library: tag · state · category · count · auto-classified flag
- Per-tag state: **Favorite** ⭐ / **Normal** / **Excluded** 🚫 (default for new tags: Normal)
- Per-tag category: Universe / ABO / Content / Trope / Dynamics / Mood / Structure / Other (default for new tags: auto-classifier output, flagged for review). Structural categories (Fandom, Relationship, Character, Rating) are sourced from Calibre columns and don't appear here.
- Filter the list by category, state, or auto-classified flag — focused curation passes
- Bulk actions: select-multi → set state, set category
- "Needs review" view surfaces auto-classified tags not yet confirmed
- **No tag renaming.** Tags are AO3 strings, immutable from the StoryHub side. Tag Management mutates only state and category assignment, never the tag string itself.
- **Category list editing window:** during the initial seeding phase, the user can rename / add / reorder categories. After clicking "Lock category list" the set becomes immutable (see [browse.md §7.3.1](browse.md)).
- Replaces `tags_audit.tsv` from old FFF as the curated source. Migration: import existing `y/n` decisions to Favorite/Excluded on first launch; categories assigned via classifier pass; everything else lands as Normal/Other awaiting review. See [../lifted-from-fff/tags-audit-workflow.md](../lifted-from-fff/tags-audit-workflow.md).

> **Hard rules:** don't treat auto-classifier output as authoritative (it's
> flagged `auto_classified` and needs review before "Lock category list"); don't
> change categories after the list is locked without a code change.

## Tag picker preferences

- Default secondary sort: Alphabetical / Frequency desc / Recently added
- (Favorited tags always pinned top regardless of secondary sort)

## This device (per-device settings, stored in IndexedDB, not synced)

- **Story open mode:** Open on AO3 / Open EPUB (pinned-aware) — see [reading.md](reading.md)
- **Device name** (free text, e.g. "Palma", "Desktop") — surfaces in the Sync view to identify which device is online
- "Pin all" / "Unpin all" maintenance buttons for this device's cache

## Worker schedule

- FanFicFare update check cadence (e.g. nightly 2am, weekly, off)
- Stale-queue alert threshold (e.g. "alert if pending > 6h")

## Sync defaults

- FanFicFare delay settings (lifted from old `config.py` — story delay, batch delay; see [../lifted-from-fff/fanficfare-integration.md](../lifted-from-fff/fanficfare-integration.md))
- Default read status for new imports (`Unread`)
- Auto-pin per Reading List is configured per-list, not in Settings (see [reading-lists.md](reading-lists.md))

## Maintenance

- "Reset cached snapshot" button (force re-download)
- "Re-upload library to R2" button
- "Refresh tag list" (regenerates the full tag set from library state)
