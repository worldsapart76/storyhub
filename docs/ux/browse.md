# Browse view

> Source: §7.3 and §7.3.1–7.3.5 of the original StoryHub design doc (incl. the
> Series B+ pattern).

[DECIDED on structure, OPEN on details]

The landing view. Designed so a casual "what should I read?" lookup takes one
or two interactions, and a deep "I'm in a very specific mood" filter is a click
away.

**Layout:** results in the main area on the left; filter panel docked on the
**right** (desktop) or as a right-side slide-out drawer (mobile, default
collapsed — see §7.3.3). Title/keyword search is a prominent always-visible row
above the results.

## Always-visible filter surface (the CB-equivalent layer)

- Search box at the top of results — searches title, author, summary
- Status chips (Unread / Priority / Read / Favorite / DNF) — three-tap include/exclude/clear model, same as tag chips
- Word count range slider
- Sort selector for results
- **Starred Saved Filter chip row** — one-tap chips for any Saved Filter the user has Starred (see [saved-filters.md](saved-filters.md))
- "More filters" button (or always-expanded on desktop) revealing the category-box surface

## Expanded filter surface (one tap away on mobile, always-visible on desktop)

- One **category box** per non-empty category (see §7.3.1 / §7.3.2)
- **Date range** — `#date_read` range, `date_added` range
- **Reading Lists** — filter to members of one or more reading lists (three-tap chips)
- **Author** — multi-select with type-as-you-search

## Tag picker semantics

- Tags marked Excluded (see [settings.md](settings.md) Tag Management) are hidden everywhere except in Tag Management itself. They do not appear in category-box chip grids, story-card displays, or analytics. To use one, un-exclude it first.
- Tags marked Favorite are pinned to the top of their category's chip grid.

## 7.3.1 Tag categories [DECIDED]

Each filter axis is a category. v1 category set, in render order:

> **Sources reconciled per redesign §6.3 / §12.6:** structural categories now
> draw from `work_tags ⋈ tags` (by `kind`) rather than the Calibre `#all_*`
> columns, and Rating from the `rating` enum (not `#maturity`). Curated
> categories reference the `categories` table. Names/intent below stand.

| # | Category | Source | Curated? | Notes |
|---|---|---|---|---|
| 1 | **Fandom** | tags (`kind=fandom`) | structural | Multi-value, raw from AO3 |
| 2 | **Relationship** | tags (`kind=relationship`) | structural | Multi-value, raw from AO3 |
| 3 | **Character** | tags (`kind=character`) | structural | Multi-value, raw from AO3 — *who appears* |
| 4 | **Identity** | tags | curated | *What a character IS in this AU* — species/role/state (Vampire X, Human Y, Trans Z). Distinct from Character (who) and Universe (world framing). **Added 2026-06-14 (Phase P); real-data audit still planned before category-list lock.** |
| 5 | **Universe** | tags | curated | AU + canon framing (Modern AU, Canon Compliant, Crossover, etc.) — *world-level* |
| 6 | **Content** | tags + AO3 warnings | curated | Sexual content + warning-style content combined |
| 7 | **Trope** | tags | curated | Plot tropes (enemies-to-lovers, found family, etc.) |
| 8 | **Dynamics** | tags | curated | Character-relationship modes (miscommunication, established relationship) |
| 9 | **Mood** | tags | curated | Tone (fluff, angst, hurt/comfort) |
| 10 | **Structure** | tags | curated | Pace and form (slow burn, one-shot, epistolary) |
| 11 | **Other** | tags | curated | Sink: explicitly othered + uncategorized fallthrough |
| 12 | **Rating** | `rating` enum | structural | 5 fixed values from AO3 |

> **ABO removed 2026-06-16.** It predated the richer Identity/Trope/Content axes
> and is now redundant: A/B/O *dynamics* ("Alpha/Beta/Omega Dynamics", knotting,
> heats) are **Trope**/**Content**; a character's alpha/omega/beta *role*
> ("Alpha Han Jisung") is **Identity**.

**Order rationale:** who/where/what-world first (Fandom, Relationship,
Character). Then narrative buckets (Universe, Content). Then narrower
vibe-shaping categories (Trope, Dynamics, Mood, Structure). Other is the sink
near the end. Rating is last as a final coarse filter.

**Naming intent (why these specific names — see handoff notes):**
- **Identity** — character-state freeforms ("Vampire Lee Minho", "Human Han", "Trans X", "BAMF X", "Alpha Han Jisung") are a large, cross-fandom class that would otherwise overload **Other**. Boundary rule: *Character = who appears · Identity = what they are in this AU (species/role/state, incl. alpha/omega/beta role) · Universe = the world's framing ("Vampires", "Paranormal", "Omegaverse" setting).*
- **Universe** (not "AU") — absorbs both AU stories AND Canon Compliant; the axis is "where/when the story lives in fictional space".
- **Content** combines sexual content AND warning-style content (Major Character Death, Graphic Violence) — the user draws no filtering distinction between them.
- **Other** is *dual-purpose*: explicitly-othered tags AND uncategorized auto-classifier fallthrough. Both meanings coexist.

**Structural vs curated:**
- **Structural** categories draw from dedicated Calibre columns. Every value in the data is automatically that category — no user assignment.
- **Curated** categories draw from the `tags` column. Each tag is sorted into a category via Tag Management (with AI assist on initial seeding and new tags).

**Category editing window [DECIDED]:** category names and order are
user-editable during the **initial seeding phase**. After the user clicks
Settings → Tag Management → "Lock category list", the category set becomes
immutable. Adding/renaming/reordering after that is a code change.

## 7.3.2 Category-box UI

One box per category that contains at least one available tag. Each box:

- Header = category name + a small mode indicator (OR by default, AND if toggled)
- **Tap/click the category header** to toggle the mode for that box. The header changes color (or shows a small `+` / `÷` glyph). The title bar IS the toggle — no separate button.
- Body = a chip grid of available tags (search-as-you-type, Favorited pinned top, secondary sort selectable)
- Empty boxes (no chips selected) contribute no filter — can stay collapsed

**Three-tap chip model for include / exclude / clear [DECIDED]** (CollectCore
pattern):

- **Default** (gray outlined) — tag is ignored
- **Include** (green filled) — one tap from default
- **Exclude** (red filled) — two taps from default (or one from Include)
- Third tap returns to Default

**Filter resolution:**
- **Green chips (includes)** combine per the box's mode — OR (default) or AND (toggled). The box-header toggle ONLY governs greens.
- **Red chips (excludes)** do NOT have a mode. They always operate as flat disqualifiers — story carrying the tag is out.
- **Mixing greens and reds in the same box is fine** — separate constraints on the same category.
- **Between category boxes:** results AND together.
- **Excludes flatten across all categories:** any single red chip anywhere disqualifies a story carrying that tag, regardless of which box it lives in.

## 7.3.3 Filter panel layout [DECIDED]

- **Desktop:** filter panel docked on the **right** of results (AO3-style). Resizable.
- **Mobile:** slide-out drawer from the **right**, dockable closed. Default collapsed; a "Sort and Filter" pill button (top-right of results) opens it. Tap outside or swipe right to dismiss.
- Right-side placement is more thumb-friendly than left for one-handed phone use.

## 7.3.4 Initial category seeding

When StoryHub launches, every tag gets a category assigned automatically:

- **Pattern matching** for the obvious cases (ends in "AU" → Universe, "Alpha/Beta/Omega Dynamics" → Trope, "Alpha/Omega/Beta <character>" → Identity, etc.)
- **Claude API classification** for ambiguous tags in batches (toggle-able)
- Anything still uncertain → Other

The user reviews/corrects in Tag Management. Auto-classified tags carry an
"auto-suggested, needs confirmation" flag until reviewed. The same classifier
runs on first-seen new tags going forward.

**API fallback toggle [DECIDED]:** Settings → Tag Management has an
"Auto-classify new tags with Claude API" toggle. When off, pattern matching
only; ambiguous tags fall to Other. Default: on. (Likely Haiku 4.5; decide at
Phase 7.)

## 7.3.5 Cross-category OR not supported in v1

A single OR group spanning two categories ("modern AU" OR "friends-to-lovers")
is not expressible — between-box logic is always AND. Acceptable for v1.
Workaround: build two Saved Filters and switch between them.

## Sort options for results (user-selectable, persists)

- Word count asc / desc
- Date added desc / asc
- Date read desc / asc
- Title (A→Z, Z→A)
- Author (A→Z, Z→A)
- Status priority (Priority → Unread → Favorite → Read → DNF, then secondary sort)
- Random ("surprise me")

## Sort options for tag pickers (Favorited always pinned top; secondary user-selectable)

- Alphabetical (default)
- Frequency in library (descending)
- Most-recently-added to library

## Result card content

Title, author, primary ship, word count, status badge, first ~100 chars of
summary. Tags shown inline as a one-line truncated row with "+N more"
tap-to-expand. Tap card → opens reading flow (see [reading.md](reading.md)).

## Series handling on cards [DECIDED — B+ model]

- If a story is part of a series (Calibre's built-in `series` + `series_index`), the card shows a small expander row: `📚 {series_name} #{N}` — and, when a filter is active, an inline `{M} of {total} match` count.
- Tap the expander → expands inline (no new view) to show all sibling stories in reading order: title · status badge · word count · first ~3 inline tags. Matching stories highlighted; non-matching dimmed but still tappable.
- Each sibling row is its own tap-to-read target.
- **Result-list sort:** active sort is respected regardless of series. Two stories from the same series can appear together OR be separated — the expander stitches them back together, not the result order.
- Series itself is NOT a Browse filter axis or nav section in v1. Series data lives only on the card, surfaced via the expander.

> **Intentional minimalism (handoff):** the user does not read series-first and
> discovers via ship/trope/mood. Do not "improve" Series by adding a nav
> section or filter axis — push back if tempted.

## Bulk actions on selected results

"Add to Reading List", "Mark as Read/Favorite/DNF", "Pin for offline".

## [OPEN] details

- Search behavior: substring (predictable, fast) vs fuzzy. Recommendation: substring, case-insensitive for v1; revisit if rough.
- Word count slider: continuous vs step buckets (<10k, 10–30k, 30–80k, 80k+). Continuous is more flexible; buckets read better.
- Saved Filter creation: "Save current filter as..." button surfaces when any filter is active.
