# Reading Lists

> Source: §7.7 (and §7.7.1) of the original StoryHub design doc.

[DECIDED]

(Renamed from "Playlists" — "Reading List" is clearer and avoids the music-app
connotation. This is the canonical name throughout the repo.)

Hand-curated story lists. Membership is explicit and stable regardless of
filters.

## v1 capabilities

- Create / rename / delete reading lists with name + description + color
- **Cover image:** user-uploadable per list. Standardized to **square, 200×200 px** display size; the upload is resized/cropped to fit (any aspect ratio accepted, center-cropped to square then scaled). Falls back to auto-generated when no upload: first member's book cover (center-cropped square); stylized name+color block for empty lists.
- Add stories to a list from any view (single story or bulk-select)
- Drag-drop reorder within a list
- Story can belong to multiple lists
- Members carry a `position` field for explicit ordering
- List view shows all members; sortable by position or any standard sort
- Filter "in list X" in Browse view
- Story count per list shown in the nav (`Travel reading (24)`)

> **Hard rule:** do not skip the 200×200 square cropping for cover images.

## Auto-pin for offline [DECIDED — ship in v1]

A per-list toggle. When on:
- Every member's epub gets downloaded from R2 to the device's local CacheStorage
- New members added to the list trigger auto-download
- Removed members get evicted (unless pinned via another list or per-story pin)
- Cross-device: list membership and auto-pin setting sync via Railway, but the actual cached epubs are per-device — each device downloads its own copies

## Per-story pin [DECIDED — ship in v1]

Independent of any list — every story card has a pin toggle. Pin a single story
for offline without making it part of a list. Pin *intent* syncs across devices
(each device downloads on its own).

## Built-in Favorites Reading List [DECIDED]

A non-deletable, system-maintained Reading List named "Favorites":
- **Membership rule:** any story with `#readstatus = Favorite` is automatically a member. User can't manually add/remove — adding = mark the story Favorite; removing = change the status.
- **Auto-pin default:** OFF. Exists as a frequent-reread reference and to make bulk-pinning every favorite onto a new device trivial when desired.
- **Sort:** default `date_read desc` (most recently favorited first); standard sort selector still works. No drag-drop reorder (membership is rule-based).
- Technically a single hardcoded "smart list." General smart lists (user-defined rules) remain deferred to post-v1.

## Bulk actions on selected list members

- Remove from this list
- Move to another list
- Add to another list

## Smart Reading Lists (general, rule-based) [DEFERRED to post-v1]

The Favorites list is the only built-in smart list in v1; user-defined smart
lists wait.

## 7.7.1 Cross-cutting workflows with Saved Filters [DECIDED]

Reading Lists and Saved Filters compose. Both ship in v1:

- **Snapshot filter → new Reading List.** From a Saved Filter view (or Browse with any filter active), "Snapshot current results as a Reading List" creates a stable, manually-editable list from what the filter shows right now. Useful for locking in a view (e.g., pre-flight pin set).
- **Add filtered → existing Reading List.** From Browse with any filter active, "Add all to Reading List X" bulk action.
