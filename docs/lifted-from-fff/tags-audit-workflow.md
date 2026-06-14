# Tags audit workflow (lifted from FFF)

> Preserved from FFF's CLAUDE.md (Tag audit workflow + tag allowlist). In FFF,
> `tags_audit.tsv` was the curated source of truth for which tags appear in the
> X4 catalog. In StoryHub it becomes a **one-time seed** for Tag Management.

## What `tags_audit.tsv` is

A TSV at the FFF project root with a `keep` column (`y` / `n` / `?` / blank) per
tag. The X4 catalog renders only tags whose `keep` is exactly `y`; everything
else is dropped silently (allowlist semantics — see
[xteink-catalog.md](xteink-catalog.md)).

## How it's built — `tools/audit_tags.py` (FFF)

Builds/refreshes the TSV by fetching the eligible library via the running
calibre-server (default `http://localhost:8080`), counting tag frequencies, and
pre-filling **auto-deny categories**:
- ratings
- archive warnings
- relationship-category markers
- format markers
- fandom names (matched via `config.COLLECTION_KEYWORDS`)
- ship tags
- character names (exact match against `#primaryship` segments after Rules 1+2 normalization, OR a Title-Case heuristic with trope-stopword exclusion)
- long-tail tags below `--threshold` (default 10)

The user's prior `y/n` decisions are preserved on re-run; only `?` and missing
rows are recomputed. Re-running is **optional** — if no library changes
invalidate existing decisions, there's no reason to refresh.

## Migration into StoryHub Tag Management

`tags_audit.tsv` lifts to `worker/data/tags_audit_seed.tsv` and is consumed
**once** on first launch, then archived. The mapping into StoryHub's
[Tag Management](../ux/settings.md) / Railway `tag_states`:

- `keep = y` → tag state **Favorite** (or at minimum **Normal** + visible)
- `keep = n` → tag state **Excluded** (`'excluded'` — hidden everywhere except Tag Management)
- categories → assigned by the initial categorization pass (pattern matching + Claude API fallback), all flagged `auto_classified` awaiting user review
- everything else → **Normal** / **Other**, awaiting review

After this seed, Tag Management (live Railway state) is the source of truth.
The catalog generator still reads an allowlist, but it's derived from
`tag_states` rather than the TSV.

> The auto-deny heuristics above are worth preserving as the seed for StoryHub's
> Excluded set — they encode a lot of curation effort.
