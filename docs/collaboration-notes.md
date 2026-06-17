# StoryHub — Collaboration Notes

**Purpose:** Context that informed the design but isn't captured in the
decomposed design docs under [.](.) (architecture, data-model, ux/*, etc.).
This is permanent reference — collaboration preferences, why specific decisions
were made, and pitfalls — not a one-time handoff. The decomposed docs are the
source of truth on *what* gets built; this file is what a session would
otherwise have to ask the user about (or, worse, silently guess).

Originally written as a session handoff while the design lived in the
FanFictionFlow repo; carried into StoryHub and kept current now that the design
is decomposed into `docs/`.

---

## 1. How the user prefers to collaborate

Patterns observed across the design conversation. Honor these unless explicitly told otherwise.

- **Step-by-step, not all-at-once.** When walking the user through any multi-step process (Cloudflare setup, doc restructuring, deployment), give one chunk at a time and wait for confirmation before continuing. A long numbered list of "do all of this" causes them to lose their place.
- **Lay out options with a clear recommendation.** When there's a decision, present 2–4 options with brief tradeoffs and a "my lean" — they almost always pick the recommendation but appreciate seeing what was rejected and why.
- **Surface tradeoffs honestly, even when you have a recommendation.** Don't gloss over downsides.
- **Compact UI labels over verbose ones.** The user rejected "Include any / Include all" in favor of bare "OR / AND" because they're the only user and screen real estate matters more than explanatory text.
- **Substantive responses are fine — bloated ones aren't.** Real design discussion warrants real length; padding doesn't.
- **The user pushes back when something is wrong.** Several design choices were corrected mid-flow (DNF still triggers AO3 mark-read; tag categories supersede nested-OR-groups; Phase 0 in old FFF was wrong because FFF is paused). Take pushback seriously and revise — don't defend the original answer.
- **Don't write code around missing context.** The user added an explicit "Pause and investigate" rule (in the StoryHub `CLAUDE.md`) precisely because they don't want migration gaps quietly papered over.

## 2. User context not in the design doc

- **Single user, personal use only.** No team, no other consumers. Every "should we support multi-user?" question has been answered "no."
- **Primary reading device is the Boox Palma** (Android e-reader). About 75% of reading time. iPad and desktop are secondary.
- **The user already has CollectCore** deployed on Railway + Cloudflare. StoryHub uses the same accounts, separate project/service. They know their way around both platforms.
- **They don't want another paid domain.** StoryHub uses the free `*.railway.app` subdomain. This is firm.
- **Library size:** 7,343 books in Calibre as of 2026-06-14. Use this for any "how big is the data" sizing decisions (R2 storage ~3.5 GB, snapshot SQLite ~few MB, etc.).
- **FFF is paused.** The user is not running FFF and will not until/unless StoryHub is scrapped. There is no transition coordination needed — only one app ever touches Calibre at a time, currently neither.

## 3. Existing infrastructure (Phase 0 — done)

All of this was set up during the design conversation. Future sessions do NOT need to walk the user through any of this again unless something breaks.

### Calibre

- Calibre Content Server running on `localhost:8080` (also reachable at `192.168.4.158:8080` on LAN)
- No auth on Calibre server (LAN-only is the security model)
- Two libraries: `FanFiction` (default, the one StoryHub cares about) and `Calibre-Commercial` (untouched)
- Custom columns verified present on the FanFiction library: `#ao3_work_id`, `#collection`, `#date_read` (datetime), `#primaryship`, `#readstatus`, `#shortsummary`, `#wordcount`, `#all_fandoms` (multi-value text), `#all_relationships` (multi-value text), `#all_characters` (multi-value text), `#maturity` (single-value text)
- The REST API uses `#` prefix natively (no `*` → `#` translation needed like the old `calibredb` CLI required)
- Adding/changing columns in Calibre Preferences requires the user to **OK out of the Preferences dialog AND restart the Calibre GUI** (not just the content server) — this confused us once

### Cloudflare R2

- Bucket: `storyhub`
- User has saved credentials in their own storage (password manager or similar): account ID, endpoint URL, access key ID, secret access key
- API token type used: **User API Token** with Object Read & Write scoped to the `storyhub` bucket. (Matches the pattern they use for CollectCore — `CollectCoreToken`)
- When the worker / Railway code needs these credentials, ask the user to paste them; do not assume any specific values

### Railway

- New project: `StoryHub` (separate from CollectCore)
- Postgres service provisioned
- Empty service `storyhub-api` exists with a public domain (`*.up.railway.app` — user has the exact URL saved)
- 7 environment variables already set on `storyhub-api`:
  - `AUTH_TOKEN` (the shared secret all clients use)
  - `R2_ACCOUNT_ID`, `R2_BUCKET_NAME`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`, `R2_ENDPOINT_URL`
  - `DATABASE_URL` (reference-linked to the Postgres service via Railway's reference feature — auto-updates if Postgres rotates)
- No code deployed yet to `storyhub-api`. Phase 1 work will involve creating the Railway service code in this repo, hooking up GitHub deployment, and pushing to this service.

### Auth token

- Generated via `python -c "import secrets; print(secrets.token_urlsafe(32))"`
- Stored in the user's credential storage AND set as `AUTH_TOKEN` env var on Railway
- Single shared secret for all clients (extension, worker, dashboard, bookmarklet) — see [auth.md](auth.md)

## 4. Decisions where the "why" matters and isn't fully in the design

### Tag category naming ([ux/browse.md §7.3.1](ux/browse.md))

The user chose specific names with specific intent:

- **Universe** (not "AU") — chosen specifically to absorb both AU stories AND Canon Compliant. The category is "where/when the story lives in fictional space" — AU and Canon Compliant both answer that. Naming it "AU" would have excluded Canon Compliant.
- **Content** combines sexual content AND warning-style content (Major Character Death, Graphic Violence, etc.). Combined intentionally because the user doesn't draw a meaningful distinction between them for filtering purposes.
- **ABO** category **removed 2026-06-16** — redundant once Identity + richer Trope/Content axes existed. A/B/O dynamics → Trope/Content; a character's alpha/omega/beta role → Identity.
- **Other** is a *dual-purpose* sink: explicitly othered tags (user decided "this is Other") AND uncategorized fallthrough (auto-classifier wasn't confident, defaults to Other awaiting review). Both meanings coexist.

### Reading Lists (not Playlists) ([ux/reading-lists.md](ux/reading-lists.md))

Was called Playlists in early drafts, renamed mid-conversation. The word "playlist" carried music-app connotations the user didn't want. "Reading List" is the canonical name throughout the repo.

### Series B+ pattern ([ux/browse.md](ux/browse.md))

The user considered options A/B/C/D. Chose B+ specifically because:

- They don't read fanfic series-first; they discover via ship/trope/mood
- A dedicated Series nav section would mostly be a curiosity tab
- The inline expander on cards is enough to navigate within a series once discovered
- Series being just data + expander avoids making it a first-class nav concept

If a future session is tempted to "improve" Series by adding nav or filter, push back — this is intentional minimalism.

### Stats deferred to v2 ([v2-deferred/stats-analytics.md](v2-deferred/stats-analytics.md))

NOT deferred because it's hard. Deferred because the user wants v1 to ship and prove out before investing in analytics. The data is being captured from launch. v2 implementation is preserved in `docs/v2-deferred/stats-analytics.md`.

### CalibreFanFicBrowser sunset

The existing CB Android app is being killed, NOT redesigned. The user originally had a CB redesign on the roadmap; the StoryHub PWA absorbed that scope. The redesign-CB item should not be revived unless the PWA fails to match what CB did.

### DNF inline AO3 action ([architecture.md §5.3](architecture.md))

DNF button on the extension does TWO things in one click: posts DNF status update to Railway + immediately fires AO3 mark-as-read POST in the same session. Don't be tempted to route DNF through the `/api/ao3-actions` queue — the user is already on AO3 when they click it, queueing would be silly.

### Per-device open mode ([ux/reading.md §7.4](ux/reading.md))

Each device remembers its own preferred open behavior (AO3 vs EPUB). Stored in IndexedDB, NOT synced via Railway. The user's instinct is that Palma wants EPUB, PC wants AO3 — and they don't want to keep changing it.

## 5. FFF — where it lives, why it stays untouched

- Location: `c:\Dev\FanFictionFlow\`
- Status: paused 2026-06-13. Not running. Not getting new code.
- Reason it stays on disk: safety net + reference. If StoryHub fails or needs to compare against the old behavior, FFF is the ground truth for "how it used to work."
- The `tags_audit.tsv` there is the seed data for StoryHub's Tag Management initial categorization (lifts to `worker/data/tags_audit_seed.tsv` in Phase 2 — see [lifted-from-fff/tags-audit-workflow.md](lifted-from-fff/tags-audit-workflow.md)).
- The original monolithic `STORYHUB_DESIGN.md` still lives in the FFF repo. It is **historical** — the StoryHub `docs/` tree (decomposed per §11) is now canonical. Do not re-sync from the monolith; if the two ever disagree, `docs/` wins. The monolith was intentionally NOT copied into StoryHub to avoid a two-source sync problem.
- FFF's `CLAUDE.md` institutional knowledge has already been lifted into [lifted-from-fff/](lifted-from-fff/). The code modules themselves lift in Phase 2 (see [open-questions.md](open-questions.md) for the lift table). The only operations against the FFF directory are read-only.

## 6. Memory system

There's a persistent auto-memory for StoryHub at
`C:\Users\world\.claude\projects\c--Dev-StoryHub\memory\` (indexed by
`MEMORY.md` there). The FFF memory directory
(`C:\Users\world\.claude\projects\c--Dev-FanFictionFlow\memory\`) primarily
holds cross-project architecture notes and is read-only history. A session may
want to seed a StoryHub memory file capturing the load-bearing points from this
doc — but prefer this file as the durable home for collaboration context;
memory is for what isn't already written down here.

## 7. Current state and next concrete work

**Done:** Phase 0 (user-side infrastructure, §3 above) and the repo scaffold —
`CLAUDE.md`, `ARCHITECTURE.md`, the decomposed `docs/` tree, the
`lifted-from-fff/` knowledge, and empty component directories
(`worker/`, `extension/`, `railway/`, `pwa/`, `bookmarklet/`). The design no
longer lives in a single monolith pointed at from another repo — it's
decomposed into `docs/` here, and this repo is self-contained.

**Next:** Phase 1 — Railway hub + R2 + worker shell. See
[build-phases.md](build-phases.md). The first real decision is the Railway
framework (FastAPI vs Node — [open-questions.md](open-questions.md)). When that
work starts, hook up GitHub deployment to the existing empty `storyhub-api`
service (§3) and push.

There's no longer a "point a new session at the FFF repo" kickoff step — start
from `CLAUDE.md` and the relevant `docs/` files for whatever phase is active.

## 8. Things that will mislead an unwary session

A few specific pitfalls:

- **The docs reference "old FFF" frequently.** A session reading them might think FFF is a live thing to interact with. It is NOT. FFF is paused, archived. The only operations against FFF's directory are read-only (lifting code/docs).
- **Phase 0 means "user setup tasks."** An old earlier draft used Phase 0 to mean "add `#date_read` write hook to FFF" — that was dropped. The docs are clean but a hasty read might confuse the two.
- **Stats ([v2-deferred/stats-analytics.md](v2-deferred/stats-analytics.md)) is preserved but deferred.** A session might think it's an active v1 feature. It is NOT. Note the `[DEFERRED to v2]` marker.
- **The `#maturity` column** is the AO3 rating. Calibre's built-in `rating` column is a 1–5 star integer and is unused. Don't conflate them.
- **The "Other" tag category** is BOTH explicitly-othered AND uncategorized-fallthrough. It's not just a sink — it's also where users put tags they actively don't want classified.
- **Railway service URL.** The user has SOME URL — not necessarily a clean `storyhub.up.railway.app`. Always ask the user for the actual URL, don't assume.

---

*End of collaboration notes. Pair with the decomposed design docs under `docs/`.*
