# FanFicFare integration (lifted from FFF)

> Preserved from FFF's CLAUDE.md (FanFicFare architecture constraints). Code
> lifts to `worker/sync/fanficfare.py` (renamed from FFF's `sync/ao3.py`) in
> Phase 2.

## Role in StoryHub (changed from FFF)

In FFF, FanFicFare did all AO3 epub downloads. **In StoryHub, FanFicFare is for
chapter-update detection on already-imported stories only** — first-fetch goes
through the browser extension's authenticated session, which sidesteps the
Cloudflare block entirely.

> **Hard rule:** do not use FanFicFare for first-fetch. Do not redesign the
> download approach to fight the Cloudflare login wall.

## Installation

FanFicFare is a standalone pip package (`pip install fanficfare`) on the Windows
side — not invoked through Calibre's plugin interface. Do not build a custom
downloader.

## Rate-limiting strategy

AO3/Cloudflare triggers rate-limiting on rapid successive downloads. Two knobs,
both user-configurable (lifted from FFF `config.py`, surfaced in
[Settings → Sync defaults](../ux/settings.md)):

- `FANFICFARE_STORY_DELAY` (default **20s**) — primary mitigation; a pause after **every individual story**.
- `FANFICFARE_BATCH_DELAY` (default **10s**) — secondary cooldown at each batch boundary, on top of the story delay.

FanFicFare stalls after a handful of downloads without any pause. The batch
structure (default 5 stories per batch) combined with the story delay addresses
this.

## Failure handling

- **Cloudflare 525 errors and all other failures are not retried.** Any failure (Cloudflare error, login block, deleted story, timeout) is returned immediately. In FFF these went to the Phase 2 browser-opener queue; in StoryHub the extension handles capture, and update-check failures are surfaced in the Sync view.
- `_is_cloudflare_error()` is retained for failure categorisation (525/524/503/502/429 → Cloudflare/amber).
- **AO3 login blocks (403 on login endpoint)** — Cloudflare bot-detection blocks FanFicFare's login POST even with correct credentials. This is **confirmed behaviour, not a bug**. Detected via `performLogin` or `archiveofourown.org/users/login` in FanFicFare output. Do not attempt to fix the Cloudflare block inline. (StoryHub avoids it entirely for first-fetch by using the extension's session.)

## FFF CLI quirks worth keeping in mind

- FanFicFare `-d` is **debug**, not directory — output directory is passed via `cwd=` in `subprocess.run`.
- FanFicFare `-o` expects `key=value` — extra options go via `FANFICFARE_EXTRA_OPTIONS`.

> StoryHub's worker uses the REST/extension model, but the FanFicFare wrapper
> for update-checks reuses these invocation patterns.
