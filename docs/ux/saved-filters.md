# Saved Filters

> Source: §7.6 of the original StoryHub design doc.

[DECIDED]

Named presets of Browse filter state (filter + sort). Apply with one tap.
Re-evaluate against current library state at view time (membership changes as
the library changes).

## What's captured in a Saved Filter

- Every filter chip state in the always-visible surface (Status, Word count range, etc.)
- Every category box's chip selections (greens + reds)
- Every category box's combine mode (OR/AND)
- Date range filters
- Reading List membership filters
- Author filter
- The chosen sort order

Saved Filters do NOT capture view density / card layout / other purely display
preferences — those are user defaults applied uniformly.

## Behavior on apply

- Tap a Saved Filter (in nav or as a starred Browse chip) → Browse view loads with all the saved state applied
- The active Saved Filter is named at the top of results (`Showing: "Marvel comfort"`)
- Modifying any filter while a Saved Filter is active either:
  - Updates the saved filter directly if user chooses "Update saved filter", OR
  - Disconnects from it (shows `Modified from "Marvel comfort"`) — the user can then "Save as..." new

## Star → Browse chip row

- Each Saved Filter has a star toggle (in the nav and in a context menu on its Browse chip)
- Starred filters appear as one-tap chips in Browse's always-visible surface
- Unstarred filters live only in the Saved Filters nav section

## Storage [DECIDED]

Railway. Sync across devices. Single source of truth.

## Display order in nav [DECIDED]

Starred filters sort to the top, the rest alphabetical — the **same ordering rule
as Reading Lists** (revised during Phase P, 2026-06-14; supersedes the earlier
"drag-drop user-orderable" plan — automatic sort was preferred for consistency
across the two list surfaces, so there is no manual drag order).

## Where filters are created [DECIDED — Phase P]

A Saved Filter is **created on Browse** (a "Save filter" control in the filter
drawer, next to "Clear all"), where the filter state being captured is live. The
Saved Filters surface is for **editing/managing** existing filters only (rename,
star, delete, snapshot-to-list, re-validate) — it has no "new filter" entry
point.

## Default seeds at install [DECIDED]

None. The always-visible Status chips already give one-tap access to Unread /
Priority / Read / Favorite / DNF — Saved Filters are for non-trivial
combinations only.

## Tag category-move behavior [DECIDED]

Saved Filters reference tag *strings* (e.g., "Modern AU"), not category
locations. If the user reassigns a tag from one category to another in Tag
Management, the Saved Filter still filters on the same stories. The visual
location of the chip moves to the tag's new category box; the filter's effect
is unchanged.

Tags themselves are never renamed (Tag Management does not expose rename — see
[settings.md](settings.md)).

## Cross-cutting with Reading Lists

See [reading-lists.md §7.7.1](reading-lists.md) — snapshot-filter-to-list and
add-filtered-to-list both ship in v1.
