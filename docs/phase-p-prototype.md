# Phase P — UI design & prototyping (handoff / progress)

> Tracks the **unwired** design prototype that satisfies redesign §13 "Phase P".
> The prototype lives in `pwa/` and is built as real React + Vite + TS components
> with **mock data only** (no API, no real epubs), so it can later become the
> Phase F scaffold. **Nothing is wired** and nothing ships until sign-off.
> Started 2026-06-14.

## How to run

```
cd pwa
npm install
npm run dev      # http://localhost:5173 — the component/surface gallery
npm run build    # tsc -b && vite build (type-check + bundle; keep it green)
```

The app entry is the **gallery harness** (`src/gallery/`), not the real app shell.
It lists every component + surface with a **Viewport** toggle (Desktop / Tablet /
Phone) and a **Theme** toggle (Light / Dark). Adding a page = one entry in
`ENTRIES` in `src/gallery/Gallery.tsx`.

## Architecture (3 layers — the global-vs-local discipline)

1. **Tokens (Layer 1, global tweak surface)** — `src/styles/tokens.css`. All
   color/space/type/radii/elevation as CSS vars + dark-theme remap. Components
   reference these, never hard-code. A global change is one edit here.
2. **Component kit (Layer 2, semi-global)** — `src/components/`. Each component +
   co-located CSS. A change ripples to every surface using it.
3. **Surfaces (Layer 3, local)** — composed from the kit with mock data.

Responsive behavior uses **CSS container queries** (`@container viewport`) so
components react to the device-frame width, not the browser — the phone frame
shows real mobile layouts.

## Built & reviewed ✅

**Foundations / tokens** — palette (accent = muted indigo, kept distinct from the
green/red chip semantics and AO3 red), AO3 rating colors, system font stack (no
web-font download, protects the Palma <2s budget), spacing/radii/elevation.

**Component kit:**
- `Button` — primary / secondary / ghost / danger / **outline** (accent), 2 sizes
- `Badge` — `StatusBadge`, `RatingBadge` (compact G/T/M/E/NR + long), `FavoriteStar`, `AvailabilityNote`
- `FilterChip` — tri-state (default→include→exclude→clear); optional ★ favorite, dashed session-temp + × remove, ◇ group/synonym
- `StatusCluster` — Unread/Read/DNF segmented + orthogonal ★; `compact`, `hideFavorite`
- `CategoryBox` — **favorited-only by default** (empty if none) + search-to-add (session, dashed, ×); ★ favorites; header toggles **OR/AND**
- `StoryCard` — independent **summary** expand and **tags** expand; expanded tags **grouped by category** with ◇ group chips; series **tap-to-expand sibling → full nested card**; action row **EPUB / AO3** (both accent) + compact status + **+ List**; ★ favorite + 📌 pin top-right
- `NavShell` — sidebar (wide) ↔ bottom tabs (narrow); Review Queue count badge
- `BulkBar`, `FilterPanel`, `BrowseView`, `Icons` (inline SVG funnel/sort)

**Surface — Browse** (`BrowseView` + `FilterPanel`) ✅
- Header: prominent search + compact **icon** Sort (dropdown, abbreviated label) + **Filters** toggle (icon). Labels collapse to icon-only on narrow.
- Filter panel **docks right** (≥880px container) / **slide-in drawer** (narrow); **one Filters button** toggles it both ways (open by default when docked; reclaims space when hidden on desktop). Panel width = `--filter-panel-w` (340px, matches drawer so chip rows don't wrap).
- Panel contents: condensed quick rows (**Status** + ★, **Words** multi-select buckets, **Rating** G/T/M/E/NR) → all **category boxes** (favorited-only) → **Word count (precise)** Min–Max → **Dates** (Read range, Added range) → **Author** search-to-add.
- Results: starred saved-filter quick chips + "Showing:" banner, count, bulk bar, card list (virtualizes at Phase F).

## Design decisions locked during Phase P

- **Tag Management** promoted to top-level nav ("Tags"), not under Settings.
- **Priority** is an ordinary (auto-starred) reading list, not a system list.
- **read_status** = Unread/Read/DNF; **Favorite** is the orthogonal ★ (not a status).
- **"Favorite"** (not "pin") for a tag always-shown-in-box — "pin" stays a work's offline copy.
- **Identity** category **adopted** (position 4: Fandom · Relationship · Character · **Identity** · Universe · ABO · Content · Trope · Dynamics · Mood · Structure · Other · Rating). `browse.md` §7.3.1 updated. Real-data audit still planned before category lock (see memory).
- **Category boxes** show only favorited tags by default (empty if none) + search-to-add — consistent for every category.
- **Word count** = multi-select quick buckets **and** a precise Min–Max range.
- **Reading-list membership** is NOT a filter-panel facet (lists live in their own nav surface).
- **Open behavior** surfaced as **EPUB** (primary) + **AO3** (when live) — both clear accent buttons.
- Browse status/favorite/wordcount/rating consolidated into the filter panel (not a second always-visible header row).
- **Reading Lists & Saved Filters share one ordering rule:** favorited/system first
  (Favorites pinned absolute-first), other starred alphabetical, rest in place.
  The Browse quick-chip row uses the same order and **color-codes** the two kinds
  (lists = amber ★, filters = indigo funnel).
- **Saved Filters are created on Browse** (filter drawer, next to "Clear all"),
  edited on the Saved Filters surface. No "new filter" entry point on that surface.
- **Saved Filters auto-sort** (starred-first/alphabetical) — replaced the earlier
  "drag-orderable" plan; `saved-filters.md` updated.
- **All result lists are infinite-scroll, never paginated.** Browse (the only
  large list, ~7k) gets windowed **virtualization** at Phase F under one
  continuous scroll; reading-list members and saved filters are small → plain
  scroll. No page boundaries (the snapshot is local in IndexedDB).
- **Worker is thin (§12.4):** Sync view splits **worker** triggers (Sync X4,
  Backup pull — gated by heartbeat) from **server** triggers (Refresh snapshot,
  Re-upload to R2 — always available). **No FanFicFare update check** (hard rule).
- **Extension hooks AO3's native buttons, injects only DNF** (§12.2): Mark for
  Later⇄Mark as Read = capture→Read; **Bookmark is intercepted → background private
  bookmark = Favorite** (no navigation to AO3's form); DNF = the one injected control
  (also marks read on AO3). **No standalone "Add" button.** **`ao3_actions` drain is
  fully automatic** (no on-AO3 banner/Confirm); failures surface in the Sync view.
  `docs/components/extension.md` reconciled (superseded banner + inline markers).

## Parked / open (not blocking Phase P)

- **Faceted/dependent filtering** — filters are independent today; co-occurrence-aware narrowing is a later (Phase F / data) discussion. (memory: faceted-filtering-parked)
- **Identity category audit** against real tag corpus before lock. (memory: identity-category-candidate)
- **AO3 social stats** (kudos/hits/comments/bookmarks) are NOT in the schema → not shown on cards. Raise as a schema change if wanted.
- Browse open details from `browse.md`: search substring-vs-fuzzy (leaning substring), continuous-vs-bucket word count (chose buckets + precise range).

## Remaining Phase P surfaces (priority order)

> **▶ PHASE P COMPLETE — SIGNED OFF 2026-06-15.** All surfaces built & reviewed
> (tokens, component kit, Browse + filter panel, story card, in-app reader, Review
> Queue, Tag Management, Reading Lists, Saved Filters, Sync view, Extension injected
> controls). The prototype is the agreed design and the **Phase F scaffold**.
> A full live click-through QA was **deferred to Phase F** (review against real
> wired data, not mock). **Next:** Phases E/F/G are unblocked — backend (Phase A
> schema → B–D) + Phase F wiring of this prototype (see "When this becomes Phase F"
> below). Honor the locked decisions + no-instructional-copy rule when wiring.

- [x] **Story card + reading flow** — card ✅; **in-app reader ✅ (reviewed)**.
  **Decision:** *no standalone detail page.* The card already expands in place to the
  full summary, all tags grouped by category, series, and actions — a separate detail
  surface just re-rendered the same fields, so it was dropped. The only genuinely new
  piece is the **in-app reader** (`Reader`, §5 fallback): full-bleed overlay with its
  **own** light/sepia/dark *reading* theme (independent of the app theme), A−/A+ font
  steps, narrow/wide column, chapter nav + progress (mock prose in `READER_SAMPLE`).
  It launches from the card's **"Read here"** action (`StoryCard` gained an optional
  `onRead`; "Open EPUB" still hands the file to the OS reader). Wired in Browse;
  reviewable standalone at gallery → Components → "In-app reader". Mock data gained
  `source`/`language`/`dateAdded`/`dateRead` (snapshot-projection fields the card may
  surface later — e.g. an "Added" date — not yet shown).
- [x] **Review Queue** — ✅ done & reviewed. **Model corrected mid-build:**
  the queue ONLY sets the per-work primary-role *flags* (`is_primary_ship` /
  `is_primary_collection`) by picking **which of the work's own raw tags** is primary
  (AO3 first-listed pre-selected). It does **not** assign/create groups — that
  contradicted §6.3.1/§9/§12.6; grouping/synonyms are entirely Tag Management. The
  card later *displays* the flagged tag via its group (flagged `Bucky/Sam` →
  "Winterhawk"). **Gate = ambiguity:** a work appears only when an axis has >1
  candidate (>1 fandom or >1 ship); single/single + gen auto-commit. Fixed §12.1
  in the redesign doc (correction note added there). `ReviewQueue` + `PrimaryAxis`
  (gallery → Surfaces → "Review Queue"): per-row work header + per-ambiguous-axis
  count chip; pick-one radio chips per axis ("AO3 first" marker; single axis shown
  static; gen → "Gen — no ship"); per-row **Confirm & commit** + bulk **Confirm
  all**, committed tally, empty state. (No Skip button — it was redundant with
  simply not acting; leaving a row unconfirmed keeps it in the queue.) Mock `REVIEW_ITEMS` now
  carries raw `fandoms[]` / `relationships[]`. (`SHIP_GROUPS`/`COLLECTION_GROUPS`
  kept in mock for the upcoming Tags surface.)
- [x] **Tag Management** — ✅ done & reviewed. `TagManagement` (gallery →
  Surfaces → "Tag Management"), two sub-views via a tab:
  - **Tags**: rebuilt on the **three composable curation layers** (redesign §6.3.1
    refinement — see that doc + memory). (1) **Canonical + synonyms** (equivalence;
    synonyms gated to the same **domain** = category-if-set-else-kind); (2) **display
    alias** (rename, `display_name`); (3) **roll-up groups** whose **class is inferred
    from member kind** — **fandom + relationship → collection** (both are XTEINK
    folder levels), descriptive kinds → property; mixed *kinds* allowed in a property
    group (warning + freeform demo: "Graphic Violence"). A tag may use all three at
    once + belong to several groups; a roll-up never overrides a tag's own primary/X4
    identity. **All identity edits are inline in the grid (no pencil):** name cell has
    an inline "display as" alias input; an **Canonical / synonym** column has a canon
    checkbox + a "synonym of…" picker. Both the **synonym** and **group** pickers are
    **searchable + alphabetised** (`SearchMenu`; the group picker also creates-on-type,
    class inferred). Table is sortable (Tag/Uses). Bulk bar mirrors the line-level
    pickers (searchable add/remove-group + Synonym-of, set category, state, ✓ Confirm)
    with applied-action feedback. All mutations live on mock. Mock: `MANAGED_TAGS`
    (`displayName`/`canonical`/`synonymOf`/classed `groups`), `TAG_GROUPS`,
    `groupClassOf`, `synonymDomainOf`.
  - **Categories**: ordered list of `FREEFORM_CATEGORIES` with up/down reorder,
    inline rename, per-category tag counts, and a **Lock category list** toggle that
    disables editing (hard rule §12.6). Identity included (pos 1 of freeforms).
  Mock: `MANAGED_TAGS`, `FREEFORM_CATEGORIES`, `TAG_GROUP_LIST`. This is where the
  group/synonym curation the Review Queue must NOT do actually lives.
- [x] **Reading Lists / Saved Filters** — ✅ done & reviewed. Two surfaces
  (`ReadingLists`, `SavedFilters`).
  - **Reading Lists** (gallery → Surfaces → "Reading Lists"): index cover-grid →
    detail. Covers are **stylized square color blocks** (the empty-list fallback;
    real uploads crop 200×200) — in detail the cover is **click-to-upload** (real
    file picker; uploaded image `object-fit:cover` on a square so the center-crop
    is visible). **Favorites** is the one system smart list: starred-by-default &
    **locked** (can't unstar), rule-derived membership (no manual add/remove/
    reorder), Manual sort **hidden** (defaults to Added), fixed name, description
    "AO3 Bookmarks". **Priority** is an ordinary auto-starred list. Index + Browse
    chips share one order via `sortReadingLists`: **Favorites first, other starred
    alphabetical, rest in place**. Detail: inline **click-to-edit** title/desc (no
    rename button), **★ star** + **📌 pin-for-offline** icons in the header, Sort
    (Manual/Added/Words/Title — Manual hidden for system), **drag-reorder via a ⠿
    grip** (only in Manual sort), member **StoryCards** with **Read here**, member
    **bulk bar** (Remove / Move to / Add to). Mock: `READING_LISTS_DATA`,
    `sortReadingLists`, `starredReadingLists`.
  - **Saved Filters** (gallery → Surfaces → "Saved Filters"): **edit/manage only**
    — **creation lives on Browse** (a "Save filter" control in the filter drawer,
    next to "Clear all"; star = icon toggle left of the name input). Rows show
    captured-state chips (green `+include` / red `−exclude` / neutral meta) + sort
    pill, **click-to-edit name**, **Apply**, ⋯ menu (Rename / Snapshot to Reading
    List / Duplicate / Delete). **Re-validate (§12.6):** a term that since folded
    into a group renders **dashed + ⚠** with `→ group` and a row **Update** action
    that rewrites it — never silently dropped. Order: **starred first, then
    alphabetical** (same rule as Reading Lists; replaced the old drag-order — doc
    updated). Mock: `SAVED_FILTERS` (+ `FilterTerm.resolvesTo`).
  - **Browse quick-chip row** now shows both, **color-coded**: reading **lists** =
    amber `★`, saved **filters** = indigo funnel glyph. (`saved-filters.md` updated:
    display-order + "created on Browse".)
- [x] **Sync view** — ✅ built, **awaiting live review**. `SyncView` (gallery →
  Surfaces → "Sync"), reconciles the Calibre-era `sync-view.md` to redesign
  §12.4–12.5. **Worker heartbeat pill** (online/stale/offline via heartbeat tokens;
  click to cycle = prototype affordance). Triggers split by scope: **Worker**
  (gated by heartbeat) = Sync X4 + Backup pull (`pc_jobs`); **Library/server**
  (always on) = Refresh snapshot + Re-upload to R2. **Queue summary** (pending/
  running/failed + Retry on failed) + **activity feed** (capture/status/snapshot/
  transfer/backup/error). **Dropped "Run FanFicFare update check"** (hard rule).
  Mock: `SYNC_TRIGGERS`, `PC_JOBS`, `ACTIVITY_EVENTS`, `SNAPSHOT_VERSION`.
  `docs/ux/sync-view.md` updated to match (FanFicFare removed, worker/server split).
- [x] **Extension injected controls** — ✅ done & reviewed. `ExtensionControls`
  (gallery → Surfaces → "Extension (on AO3)"): a **mock AO3 work page in the user's
  dark skin** (two-row dark header, right-aligned beige action row, dark meta `dl`
  with lavender tag links, centered serif preface, work text) so the injected bits
  are reviewable IN CONTEXT. Host chrome uses fixed AO3 colors (ignores the gallery
  theme toggle — it's an external page); injected bits are indigo + ◆.
  **Interaction model corrected to redesign §12.2** (see `docs/components/extension.md`
  superseded banner): the extension **hooks AO3's native buttons, injects only DNF**.
  - **Mark for Later** ⇄ **Mark as Read** (one native toggle) = capture (+epub) → Read.
  - **Bookmark** is **intercepted** → background **private** bookmark = Favorite (★ +
    Read); click again removes it. (AO3's button only navigates to a form, so the
    extension creates the bookmark via a background authenticated POST — no navigation.)
  - **DNF** = the one injected ◆ control: capture-if-needed + DNF + mark-read on AO3.
  - **Status badge beside the title** (Unread/Read/DNF + ★) — where the user's
    status-badge extension already sits; N/A = not in library.
  - **Drain is fully automatic** on AO3 page loads — **no on-AO3 banner, no Confirm**;
    failures surface in the **Sync view**, never silently. (Dropped the earlier
    Calibre-era pending/Confirm banner.)
  Mock: `EXT_WORK` (+ AO3 blurb fields). `LISTING_ROWS`/`PENDING_AO3_ACTIONS` remain
  in mock for later (listing-badge view + Sync wiring) but are unused on this surface.
- [x] **Sign-off — ✅ GRANTED 2026-06-15.** Phase P is complete; the prototype is the
  agreed design and the Phase F scaffold. Phases E/F/G are unblocked. A full live
  click-through QA was **deferred to Phase F** by the user (review against real
  wired data rather than mock).

## When this becomes Phase F

The prototype is intentionally the future scaffold. At wiring time: add
`vite-plugin-pwa`, list virtualization (`@tanstack/react-virtual`) for the result
list, real snapshot→IndexedDB data, optimistic writes → Railway. Replace
`src/mock/data.ts` with the snapshot projection (§12.3); the component prop shapes
already mirror it.
