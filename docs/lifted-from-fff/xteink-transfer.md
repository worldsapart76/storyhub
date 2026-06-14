# Xteink X4 / Crosspoint transfer (lifted from FFF)

> Preserved from FFF's CLAUDE.md (Xteink X4 / Crosspoint Transfer section).
> Code lifts verbatim to `worker/export/xteink_transfer.py` in Phase 2.
> **Do NOT change the folder structure or filename format** — Crosspoint
> indexes by content hash; structure changes orphan caches.

## Device

The X4 is an ESP32-C3 e-reader running [Crosspoint Reader](https://github.com/crosspoint-reader/crosspoint-reader)
firmware. Crosspoint has no USB mass-storage mode — file transfer requires
ejecting the SD card and mounting it on the PC. Crosspoint's file picker does
not auto-rescan after the card is reinserted; **the device must be power-cycled**
for new files to appear (the dashboard surfaces a reminder after transfer).

## Folder structure on device

`<sd_root>/<Collection>/<Ship>/<Status>/[NNN]-Title.epub`

- `Collection` — Calibre `#collection`, sanitized (Windows-illegal chars stripped, `/` → `-`)
- `Ship` — Calibre `#primaryship`, same sanitization (e.g. `Bucky/Clint` → `Bucky-Clint`)
- `Status` — Calibre `#readstatus`, must be one of `Unread`, `Priority`, `Favorite`. Books with status `Read` or `DNF` are **never transferred** and are **removed from the device** if found there. Blank/missing status is normalised to `Unread` by the caller.
- Filename — `[NNN]-Title.epub` where `NNN` = `min(words // 1000, 999)` zero-padded to 3 digits (10,752 → `010`, no rounding). Title has all punctuation stripped (only letters/digits/spaces kept).

## Sync semantics

- Source of truth: a **fresh** library query at transfer time. Not in-memory sync state — the X4 transfer is a "snapshot the current curated library" operation, independent of any sync run.
- Skip-if-already-on-device by **target full path** (Collection/Ship/Status/filename) — handles status changes (Unread → Favorite) automatically as remove-from-old-path + add-at-new-path.
- Files outside FFF-managed depth (4 path parts, third part in `XTEINK_MANAGED_STATUSES` = {`Unread`, `Priority`, `Favorite`}) are ignored entirely — user-dropped content at the SD root or in unrelated folders is never touched.
- Empty managed folders (status, ship, collection) are pruned bottom-up after removal, but only ancestors of files actually touched in this run — never directories holding user content.
- Crosspoint's `.crosspoint/` cache directory is **deferred for cleanup** — stale per-book caches (path-orphaned after removal) are not currently pruned. The user can manually delete `.crosspoint/` if it grows; reading position is not preserved across syncs by design.

## SD card detection

Auto-detection scans drive letters D:–Z: looking for one with a `.crosspoint/`
directory at root. Settings/dashboard offers a Detect button. An override path
can be set explicitly and is validated against `.crosspoint/` presence before
use.

## Do not

- Sync read status from the X4 back to Calibre — the X4 is read-only for metadata. Status curation happens via the dashboard/extension flow.
- Touch files outside the FFF-managed depth — they are user content.
- Add `.crosspoint/` cache-invalidation logic without a stable hash mapping (Crosspoint hashes EPUB content; replicating the algorithm in Python is a sub-project).

The catalog EPUBs generated as part of every transfer are documented separately
in [xteink-catalog.md](xteink-catalog.md).
