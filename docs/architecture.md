# Architecture

> Source: §1–§5 of the original StoryHub design doc. This is the system-level
> spec. For per-component depth see [components/](components/); for the data
> model see [data-model.md](data-model.md).

## 1. Purpose & scope

StoryHub is the successor to FanFictionFlow. It absorbs the orchestrator's job
(sync AO3 → Calibre → reading devices) and adds a tag-aware
browsing/discovery layer that AO3 itself doesn't provide for Marked-for-Later
stories.

**The headline shift:** the old app is a local tkinter orchestrator that
batch-processes via CSV files. StoryHub is a distributed system — a browser
extension lives on AO3 doing real-time capture, a Cloudflare-backed hub holds
queues and snapshots, a headless local worker on the PC drives Calibre and
FanFicFare, and a PWA dashboard serves browsing/management from any device.

**What StoryHub is NOT:**
- Not a replacement for Calibre — Calibre stays source of truth.
- Not a replacement for FanFicFare — still used for chapter-update detection on existing stories.
- Not a public service — single-user, token-auth, free `*.railway.app` subdomain.
- Not a manga/non-AO3 reader. AO3-only.

## 2. What StoryHub replaces

| Old (FFF) | New (StoryHub) |
|---|---|
| tkinter desktop GUI | PWA dashboard on Railway |
| Tampermonkey Marked-for-Later CSV export | Browser extension real-time capture |
| Read Status Badge Chrome extension | Folded into the same browser extension |
| `marked_for_later.csv` batch diff | Per-story queue items |
| `palma_readstatus_overrides.csv` round-trip | Direct status update from CB-replaced dashboard |
| `library_csv_YYYYMMDD_HHMMSS.csv` exports | Library snapshot in R2, versioned |
| ADB push of epubs to Palma | Wi-Fi fetch from Cloudflare R2 |
| Phase 2 browser-opener dialogs | Inline extension banners on AO3 |
| CalibreFanFicBrowser Android app | Sunset — dashboard PWA takes over |

What stays unchanged:
- Calibre library and content server (just turned on)
- FanFicFare for chapter-update detection on existing stories
- Xteink X4 SD-card transfer and catalog EPUB generation (lifted verbatim from FFF)
- All ship normalization Rules 1–5 and collection keyword logic

## 3. Architecture overview [DECIDED]

See [../ARCHITECTURE.md](../ARCHITECTURE.md) for the full ASCII diagram.

### Why this shape

- **Calibre stays source of truth.** Railway is a queue/relay, not a database. R2 is a delivery cache. Both can be wiped and rebuilt from Calibre.
- **Worker can be offline.** Queue items accumulate on Railway, drain when worker reconnects. PC sleep / restart / crash doesn't lose data.
- **PWA can be offline.** Snapshot cached in IndexedDB, epubs cached in CacheStorage, status updates queued locally and drain when network returns.
- **Extension uses authenticated browser session.** Bypasses the Cloudflare-blocks-FanFicFare problem on first-fetch entirely. FanFicFare still owns chapter-update detection (where authenticated session isn't needed).

## 4. Components

Each component has its own spec under [components/](components/):

- **4.1 Browser extension** → [components/extension.md](components/extension.md)
- **4.2 Bookmarklet** → [components/extension.md](components/extension.md) (§4.2 section)
- **4.3 Railway services** → [components/railway-service.md](components/railway-service.md)
- **4.4 Cloudflare R2** → [components/cloudflare-r2.md](components/cloudflare-r2.md)
- **4.5 Local worker** → [components/worker.md](components/worker.md)
- **4.6 Calibre content server** → [components/calibre-server.md](components/calibre-server.md)
- **4.7 Dashboard PWA** → [ux/pwa-shell.md](ux/pwa-shell.md) and the rest of [ux/](ux/)

## 5. Data flows

### 5.1 Mark-for-Later → ready in library [DECIDED]

```
User on AO3 → Extension/bookmarklet captures metadata + fetches epub →
POST /api/queue → Railway stores + streams epub to R2 staging →
Worker long-polls, picks up item → Worker downloads from R2 →
Calibre add via REST → Normalization runs →
  ├─ Auto-resolved: metadata written immediately, snapshot bumped, done
  └─ Review-needed: held in review bucket, dashboard surfaces it
User confirms in dashboard → Worker writes metadata, snapshot bumped
Devices see new books at next snapshot read
```

Each story is its own work item with its own state machine. Auto-resolved
stories don't wait on review-needed ones. Review confirmations are per-row
(not batched).

### 5.2 Reading → status change → AO3 sync [DECIDED]

```
User reads on device (Palma browser PWA, or any device)
User marks Read / Favorite / DNF in dashboard →
POST /api/status-updates {work_id, new_status, source: 'dashboard_manual'} →
Worker drains → writes #readstatus + #date_read to Calibre →
  ├─ Source requires AO3 action → enqueue to /api/ao3-actions
  └─ Source already did the AO3 action → skip
Worker pushes new snapshot
Next time user is on AO3, extension shows pending actions banner →
User confirms → extension executes actions → /api/ao3-actions ack
```

### 5.3 Status update source matrix [DECIDED]

The `source` field on every status update determines AO3 sync handling:

| Source | Triggered when | Update Calibre | Queue AO3 action for later? | Extension does AO3 action inline? |
|---|---|---|---|---|
| `dashboard_manual` | User changes status in dashboard PWA | yes | **yes** (mark-read; +bookmark if Favorite). User wasn't on AO3, so action waits for next visit. | n/a |
| `extension_ao3_native_read` | User toggles Mark-for-Later off on AO3 | yes | no (AO3 already updated by user's native click) | n/a |
| `extension_ao3_native_favorite` | User completes a bookmark on AO3 | yes | no (AO3 already updated by user's bookmark save) | n/a |
| `extension_dnf_button` | User clicks DNF button on AO3 work page | yes | **no** | **yes** — extension fires mark-as-read POST immediately in the same session. |
| `cb_app_legacy` | Pre-sunset CB app (transitional only) | yes | yes | n/a |

**Why the inline path for DNF specifically:** the user is sitting on the AO3
work page when they click the extension's DNF button. The extension already
has authenticated access to AO3 in that session. Queuing the mark-as-read for
a "next AO3 visit" would be silly — that visit is right now. So the DNF flow
is: POST status update to Railway + fire AO3 mark-as-read in parallel.

The `/api/ao3-actions` queue path exists only for status changes that
originated **away from AO3** (dashboard, CB legacy) where the user wasn't on
AO3 when the change happened. When they eventually load any AO3 page, the
extension picks up the queue and surfaces the banner.

**Bookmark rule:** any bookmark on AO3 = Favorite in Calibre. No distinction
based on the "Recommend" checkbox.

### 5.4 Background flows [DECIDED]

- **Worker heartbeat** every ~30s. Dashboard shows worker status badge based on `time_since_last_heartbeat`.
- **Stale-queue check** Railway-side: if `min(pending_age) > threshold`, dashboard surfaces banner. Optional email/push notification ([DEFERRED] until annoyance proves it's worth setting up).
- **FanFicFare update check** scheduled (default nightly, configurable). Walks library checking for new chapters on Unread/Priority stories. Updated epubs replace in Calibre + R2, snapshot bumps.
- **R2 backfill on first run** of new worker: uploads existing Calibre library to R2. One-time, ~7,343 books × ~500 KB = ~3.5 GB. Pace politely.

### 5.5 X4 transfer [DECIDED — unchanged from current FFF]

Triggered from dashboard "Sync X4" button. Worker does:
- Detect SD card via `.crosspoint/` marker
- Fresh fetch from Calibre
- Build folder tree (Collection/Ship/Status) with `[NNN]-Title.epub` naming
- Skip-by-target-path
- Prune Read/DNF + empty managed dirs
- Generate multi-file catalog EPUBs with adaptive splitting
- Surface "power-cycle X4" reminder in dashboard

Code lifts verbatim from FFF. See
[lifted-from-fff/xteink-transfer.md](lifted-from-fff/xteink-transfer.md) and
[lifted-from-fff/xteink-catalog.md](lifted-from-fff/xteink-catalog.md).
