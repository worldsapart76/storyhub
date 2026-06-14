# Xteink X4 library catalog EPUBs (lifted from FFF)

> Preserved from FFF's CLAUDE.md (Library Catalog EPUBs section). Code lifts
> verbatim to `worker/export/xteink_catalog.py` in Phase 2. Generated as part of
> every `Xfer to XTEINK` run.

## Output location & naming

Written to `<sd-root>/_catalog/00-Catalog - {Label} - {YYYYMMDD-HHMMSS}.epub`.
The `_catalog` subfolder keeps every catalog file in one place at the top of
Crosspoint's file picker (`_` sorts ahead of letters); the trailing UTC
timestamp guarantees each generation has uniquely-named files so Crosspoint's
content-hash cache can never confuse a fresh catalog with a stale one.
Hand-rolled EPUB 3 (zip + XHTML + content.opf + nav.xhtml) — no external
dependency.

## Automatic cleanup of prior generations

After writing the new files, `generate_catalog()` cleans, in order: (1) files
inside `_catalog` matching the naming pattern whose basenames aren't in this
run's set, (2) any catalog files still at the SD root from before the `_catalog`
subfolder was introduced, (3) the legacy single-file `00-Library Catalog.epub`.
Only files matching the catalog naming pattern are touched — user content is
safe. (Crosspoint's `.crosspoint/` cache still accumulates entries for removed
files; clearing it from device settings remains a manual step.)

## Multi-file partitioning (why bytes, not spine count)

The catalog is split across multiple EPUBs to keep each file small enough for
the ESP32-C3 to index quickly. Crosspoint indexes one file at a time and caches
its sections, so opening Stray Kids only pays Stray Kids' indexing cost.
Empirically, **bytes drive indexing time, not spine count** (~415 KB single-file
catalog: indexed in seconds; ~1.5 MB single-file with summaries: still slow).

Fandoms in `XTEINK_CATALOG_SOLO_FANDOMS` (default: Stray Kids, Harry Potter,
Teen Wolf, Roswell) each get their own `00-Catalog - {Fandom}.epub`. Everything
else is bundled into `00-Catalog - Other Fandoms.epub`. Empty solo fandoms
produce no file. Pass `solo_fandoms=[]` to bundle everything into a single file
(tests / emergency override).

## Structure inside each EPUB

cover.xhtml + per-fandom XHTML files. Each fandom carries two jump indices (only
non-empty axes appear): **Favorites By Ship** and **Unread By Ship**.

Sort orders within sections:
- `Favorites - {Ship}` — length asc → title
- `Unread - {Ship}` — Priority entries first, then non-Priority, both blocks length asc → title

Each story-list section has skip-to-end at the top and skip-to-start at the
bottom so the user can jump straight to the longest story without scrolling.

Story entry fields: title (heading) · author | series name #N (only if series
set) · status | NN,NNN words (raw count) · tags · summary HTML · 📂 device path.
Story details are *replicated inline* in each section a story qualifies for —
acceptable because it's just text.

## Summary source — `#shortsummary` only

The summary block is rendered **exclusively** from `#shortsummary`; the long
unprocessed `comments` field is **never** read by the catalog (it was the
dominant contributor to slow indexing). If `#shortsummary` is empty, no summary
block appears. The field is populated two ways: (1) a tool auto-copies any
source comment ≤ 100 words verbatim into `#shortsummary` (HTML-stripped), and
(2) a Claude Haiku 4.5 summarizer compresses longer comments to ~50 words.

## AI marker convention

Anything written by the AI summarizer path always has ` · AI` appended
(`AI_SUMMARY_SUFFIX`); verbatim copies carry no marker. The split is based on
**which tool wrote the value**, not output length. The marker is stored in the
field itself (travels with the data through every export) and uses the
middle-dot separator. Any future summarizer must use the same suffix — do not
change the format without updating both the writer and downstream tooling that
searches for the marker.

## Adaptive splitting

Any fandom whose single-file XHTML exceeds the threshold (default **200 KB**) is
rebuilt as an overview-only file plus one file per non-empty section
(`fandom-{slug}-overview.xhtml`, `fandom-{slug}-fav-{ship}.xhtml`,
`fandom-{slug}-unread-{ship}.xhtml`). ESP32-C3 RAM forces the cap; Crosspoint
paginates one spine item at a time, so smaller spine items are essential for
large fandoms.

Eligible scope matches the transfer step (Unread/Priority/Favorite). Read/DNF
never indexed. Books missing collection or ship are dropped. Catalog is
regenerated from scratch every run — no incremental builds, no stale entries.

## Tag filtering — allowlist semantics

The catalog filters AO3 tags through `tags_audit.tsv`. Only tags whose `keep`
column is exactly `y` are rendered; **everything else (`n`, `?`, blank, or
absent) is dropped silently**. New tags won't appear unless added to the TSV.
This is intentional — the audit is the curated source of truth for "tags worth
seeing during selection". See [tags-audit-workflow.md](tags-audit-workflow.md).

If `tags_audit.tsv` is missing or has no `y` rows, the filter falls back to "no
filter" (lenient) — prevents an accidentally-deleted TSV from stripping every
tag.

> **StoryHub note:** Tag Management (Railway `tag_states`) supersedes
> `tags_audit.tsv` as the live curated source; the TSV becomes a one-time seed
> (see [tags-audit-workflow.md](tags-audit-workflow.md)). The allowlist
> semantics above are preserved for the catalog generator.

## Failure handling

If `generate_catalog()` raises, the transfer is still the primary outcome —
status shows "XTEINK transfer complete — catalog failed" (amber); the user can
re-run. Catalog failure does not roll back the file transfer.

## Linking limitation

Internal jump-list links inside the catalog work fine. **EPUB-to-EPUB
filesystem links are not supported** by current Crosspoint firmware — tapping a
story entry cannot directly open the story's epub. The user reads the device
path from the catalog and navigates manually. A custom URI scheme would require
a firmware fork (out of scope).
