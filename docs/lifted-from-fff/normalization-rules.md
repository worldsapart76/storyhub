# Normalization rules (lifted from FFF)

> Preserved institutional knowledge from FanFictionFlow's CLAUDE.md
> (Metadata Normalization Rules + Status normalization sections). The code
> lifts to `worker/normalize/ship.py` and `worker/normalize/rules.py` in Phase
> 2. **Do not change these rules without reading this doc and flagging it** —
> they are battle-tested and user-curated.

These rules produce `#primaryship` and `#collection` from raw AO3 metadata, and
decide which stories auto-resolve vs. land in the [Review Queue](../ux/review-queue.md).

## Primary Ship (`#primaryship`)

Apply rules in order:

**Rule 1 — Strip alias suffixes.** Within each name segment, strip ` | Alias`
and everything after it.
- `Lee Minho | Lee Know` → `Lee Minho`
- `Han Jisung | Han` → `Han Jisung`

**Rule 2 — Strip fandom disambiguation suffixes.** Remove parenthetical fandom
tags appended to character names.
- `Lee Felix (Stray Kids)` → `Lee Felix`

**Rule 3 — Poly detection (any one signal triggers Poly).** After Rules 1 & 2:
1. Splitting on `/` yields 3 or more distinct names
2. Any name segment is `Everyone`
3. `additional_tags` field contains `Polyamory` or `Polyamory Negotiations`

If any signal fires → `#primaryship = Poly`. Skip remaining rules.

**Rule 4 — Calibre library lookup.** Check cleaned value against existing
`#primaryship` values in Calibre (case-insensitive). If match found, use the
canonical Calibre value exactly. Handles the majority of cases.

**Rule 5 — Shortname override table.** Apply known full-name → shortname
mappings. User-editable; stored in config.

| Cleaned AO3 value | Calibre value |
|---|---|
| `Katniss Everdeen/Peeta Mellark` | `Katniss/Peeta` |
| `Elizabeth Bennet/Fitzwilliam Darcy` | `Darcy/Elizabeth` |
| `James "Bucky" Barnes/Clint Barton` | `Bucky/Clint` |
| `Jason Todd/Tim Drake` | `Tim Drake/Jason Todd` |
| `Regulus Black/James Potter` | `Regulus/James` |

> Some ships use fan-preferred shortnames (e.g., Malex) already normalized in
> the Calibre library. These resolve via Rule 4.

**Unresolved → review queue:**
- Cleaned value not found in Calibre and no shortname override exists
- Blank, malformed, or non-standard tag format (e.g., `hyunibinnie - Relationship`)
- Tag contains `&` rather than `/` (friendship, not romantic) — these fall through to review by design

## Collection (`#collection`)

Derived from the AO3 `fandoms` field via keyword matching. First keyword match
wins. User-editable in config.

| Keyword | Collection |
|---|---|
| `Stray Kids` | `Stray Kids` |
| `ATEEZ` | `ATEEZ` |
| `Hunger Games` | `Hunger Games` |
| `Harry Potter` | `Harry Potter` |
| `Batman`, `DCU`, `DC Comics` | `DCU` |
| `Marvel`, `Avengers` | `Marvel` |
| `Pride and Prejudice`, `Jane Austen` | `Jane Austen` |
| `Roswell New Mexico` | `Roswell` |
| `Mass Effect` | `Mass Effect` |
| `Dragon Age` | `Dragon Age` |
| `Shadowhunters`, `Mortal Instruments` | `Shadowhunters` |
| `Star Wars` | `Star Wars` |
| `Teen Wolf` | `Teen Wolf` |
| `Witcher` | `Witcher` |
| `Skyrim`, `Elder Scrolls` | `Skyrim` |

**Multi-fandom tiebreaker:** if multiple keywords match, use the primary ship to
determine which fandom the story belongs to.

**No match → review queue.**

## Status normalization

From FFF's `_normalize_status()`. Applies to any read-status value before it's
written to Calibre:
- `"DNF"` → all-caps
- everything else → title case (Read, Favorite, Priority, Unread)

**Never sync `"Unread"`** from any device/source — it's the device default, not
a deliberate user action. (In FFF this was the Palma CSV; in StoryHub it
applies to every status source.) Writing `"Unread"` back would overwrite
deliberate statuses across the library.

## Review Queue write discipline (carried into StoryHub)

- Nothing writes normalized metadata to Calibre before the user confirms in the Review Queue.
- `#readstatus` is only written for **fresh imports** — books that already had a status are skipped, to avoid resetting the library to "Unread". (FFF: `fresh_calibre_ids` only.)
