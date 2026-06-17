# Faceted (co-occurrence-aware) Browse filtering

**Status:** scoped + in build, 2026-06-17. Browse-first; reusable for Tag
Management later. Supersedes the "parked" note in the collaboration memory.

## Problem

Browse filter selections are **independent**: with Fandom = Teen Wolf selected,
the Identity / Relationship / etc. boxes still offer tags that never co-occur with
Teen Wolf, and every count is the *global* library count. With a ~6.7k-work
library and tens of thousands of tags, that makes narrowing slow and noisy.

## Behaviour

Every active selection — **any** tag category (Fandom, Relationship, Identity, …)
**and** the quick filters (Status, Rating, Words, Author, Favorite), including
**exclude** chips — together define one "matching works" set. Each *other* facet's
options and counts are computed against that set. So narrowing anywhere ripples
everywhere.

- **Live counts**: each chip shows its co-occurring story count, updating as
  filters change.
- **Tag boxes hide zero-match options** (decision 2026-06-17). Selected/active
  chips always stay visible so they remain deselectable. Chosen over grey/counts-
  only because categories are huge (Identity ~5k, freeforms ~27k) — hiding keeps
  each box scannable.
- **Quick filters** (only 3–5 chips each) show count + **disable-at-0** rather than
  vanish (a Status/Rating chip disappearing is more confusing than helpful).
- **Search-to-add** inside a box is restricted to co-occurring tags (> 0) and
  ranked by the live count.

### Leave-one-out (the key rule)

A facet is counted against all **other** active constraints but **not its own**, so
a box never limits itself: after you pick one ship (OR mode) the Relationship box
still shows the *other* ships in the narrowed set instead of collapsing to your
pick. Each box does this only for itself; it always honours every other category's
includes and excludes.

### Scope basis

The co-occurrence basis is the works in scope **before** the filter panel — i.e.
after the text search and any active reading-list chip — so those narrow the
available options too. With no filters active, the live counts equal today's global
counts, so nothing looks different until you start selecting.

## Implementation (all client-side; no backend/snapshot change)

Filtering is already a pure function over the in-memory `works` array, and each
`Work` carries its full tag list with category — so co-occurrence is computed in JS
from data already loaded.

- `pwa/src/data/filters.ts` — `dependentFacets(works, filter)`: returns
  `{ total, tags: Map<Category, Map<name, count>>, status, rating, buckets }`,
  each computed leave-one-out. **The reusable core** Tag Management can call later.
  Must stay in sync with `applyFilters()`.
- `pwa/src/components/BrowseView.tsx` — compute it memoized on `[searched, filter]`
  (`searched` = works after text-search + active list); pass to the panel.
- `pwa/src/components/CategoryBox.tsx` — chips use the live counts; hide count-0
  (except selected/active); suggestions restricted to co-occurring + ranked by it.
- `pwa/src/components/FilterPanel.tsx` — live counts on the Status / Rating /
  Word-count chips, disabled at 0.

**Performance:** ~11 categories × 6.7k works, recomputed per filter change, < ~30ms
(precomputes per-work lowercased tag-name sets once; only active categories do a
full leave-one-out pass, the rest reuse the all-filters match set). Non-issue.

## Build order

1. Core `dependentFacets` + Browse wiring + tag boxes (hide-zeros, live counts).
2. Quick-filter counts (Status / Rating / Words).

## Later (not now)

Apply the same `dependentFacets` core to **Tag Management** (filter the tag table
by a fandom → show only co-occurring tags) if wanted. Pairs with the planned
"open this tag in Browse" action.
