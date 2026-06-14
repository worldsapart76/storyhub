# Stats / Analytics [DEFERRED to v2]

> Source: §7.8 of the original StoryHub design doc. Preserved here so the design
> intent isn't lost. **Not a v1 feature** — no Stats nav item in v1.

Entire analytics surface deferred to v2 (decided 2026-06-13). **Deferred
because the user wants v1 to ship and prove out before investing in analytics —
NOT because it's hard.**

## What this means for v1

- The data still accumulates correctly — `#date_read` is populated by the worker on every Read/Favorite/DNF transition; `date_added` is populated by Calibre automatically; tag/fandom/ship/etc. data flows in via the normal import path.
- By the time v2 ships, the data will be there waiting — no retroactive backfill needed beyond the existing AO3 History pass.
- The Tag Management Excluded state still works (it filters Browse and pickers) — it just doesn't yet have an analytics view to filter as well.

## Planned for v2

- **Reading over time** — line chart: books finished per month. Toggle to word count instead of book count.
- **By fandom** — bar chart: words read per fandom, all-time. Filter to date range.
- **By ship** — same but by ship.
- **Most-read tags** — table sorted desc by count, drawn from the Browse-eligible tag set (Excluded tags never appear). Tap a row → Browse pre-filtered to that tag. A "send to Excluded" inline action gives a one-tap path to clean noise out of the list.
- **Library growth** — line chart of `date_added` over time. Stories added per month.
- **Status mix** — pie or bar of current status distribution.
- **Unread aging** — list of oldest Unread stories by `date_added`. "What have I been meaning to read forever?"

## Deferred further (post-v2)

- AI taste model. Real, feasible, separate design pass once the rest is working.
- Per-session reading time tracking. Requires instrumentation, not in scope.
- Recommendations based on tag co-occurrence. Possible add later.
