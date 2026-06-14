# Calibre quirks (lifted from FFF)

> Preserved from FFF's CLAUDE.md (Calibre locking, custom-column naming, and
> environment quirks). StoryHub moves from `calibredb` CLI to the Calibre
> Content Server REST API — some of these no longer bite, but the history
> explains why the code looks the way it does. See also
> [../components/calibre-server.md](../components/calibre-server.md).

## REST vs CLI: the `#` / `*` convention

- **Calibre Content Server REST returns custom columns with the `#` prefix natively** — no translation needed. Value lives at `user_metadata['#colname']['#value#']`.
- The old `calibredb list` CLI used a `*fieldname` prefix for custom columns; FFF's `calibre.py` normalized `*` → `#` internally. **StoryHub does not need this translation** because it's REST end-to-end.

> **Hard rule:** no `calibredb` CLI in StoryHub — REST via the content server
> only.

## Datetime format

Calibre datetime columns store full timestamps in ISO8601 with timezone.
`#date_read` writes use **noon UTC** (`YYYY-MM-DDT12:00:00Z`) so the displayed
calendar date is stable regardless of viewer locale (see
[../data-model.md §6.1](../data-model.md)). The time-of-day component carries no
meaning.

## Multi-value (tag-like) columns

`#all_fandoms`, `#all_relationships`, `#all_characters` are `is_multiple`
("like tags") columns. `#maturity` is single-value. Calibre's built-in `rating`
column is a 1–5 star integer and is **unused** — AO3 rating lives in `#maturity`
(text). Do not conflate them.

## GUI locking (historical, mostly resolved)

- With the **CLI**, `calibredb` failed if the Calibre GUI was open; FFF detected this at startup and warned.
- With the **content server**, this no longer applies — concurrent reads work with the GUI open (verified 2026-06-13). The "Calibre GUI must be closed" constraint is gone for StoryHub.
- One residual gotcha: changing custom columns in Calibre Preferences requires OK-ing out of Preferences **AND restarting the Calibre GUI** (not just the content server) for the change to take.

## `set_custom` patterns (CLI → REST)

FFF wrote metadata via `calibredb set_custom`. StoryHub's worker uses the REST
equivalent. When porting write logic, preserve the discipline:
- Only fresh imports get `#readstatus` written (never overwrite an existing status).
- Always pass status through `_normalize_status()` first (see [normalization-rules.md](normalization-rules.md)).

## Environment quirks (Windows, from FFF)

These applied to the FFF CLI/test setup. Carry forward the ones relevant to the
StoryHub worker (Windows-only, Python 3.12):
- **`python3` does not exist on Windows** — use `python` in PowerShell.
- **`python -B`** for manual/integration scripts — Python caches `.pyc` aggressively; `-B` avoids running stale bytecode.
- **`#` in PowerShell strings** — safe inside double-quoted strings.
- **`CREATE_NO_WINDOW` on all subprocess calls** — FFF passed `creationflags=subprocess.CREATE_NO_WINDOW` on every Windows subprocess call (calibredb, FanFicFare, ADB) to stop console windows flashing/stealing focus. Any remaining subprocess use in the StoryHub worker (e.g. the FanFicFare update-check wrapper) should keep this flag.
- **`calibredb add` was slow** (~60–90s on a 6,700-book library) — relevant only if any CLI path lingers; REST add timing should be re-measured.
