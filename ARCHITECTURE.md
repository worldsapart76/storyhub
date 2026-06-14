# StoryHub — Architecture Overview

Short overview. Full detail in [docs/architecture.md](docs/architecture.md)
and the per-component specs under [docs/components/](docs/components/).

## The shape

StoryHub is a distributed, single-user system. Calibre is the source of
truth; everything else is a queue, cache, or view that can be rebuilt from it.

```
┌─────────────────────────────────────────────────────────────────────┐
│                          AO3 (external)                              │
│  Mark-for-Later list · History page · Work pages · Epub downloads   │
└─────────────────────────────────────────────────────────────────────┘
                                  ▲ authenticated browser session
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  BROWSER (any device)                                                │
│  ├── Desktop Chrome/Firefox: StoryHub extension                     │
│  ├── Firefox Android: StoryHub extension                            │
│  └── Mobile Chrome / Edge / Safari: bookmarklet                     │
└─────────────────────────────────────────────────────────────────────┘
                                  │ HTTPS (auth token)
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RAILWAY (cloud hub — free *.railway.app subdomain)                  │
│  /api/queue · /api/status-updates · /api/snapshot · /api/worker ·    │
│  /api/ao3-actions · /api/reading-lists · /api/saved-filters ·        │
│  Dashboard PWA                                                       │
└─────────────────────────────────────────────────────────────────────┘
         ▲ poll/push                          ▲ read
         ▼                                     │
┌──────────────────────────────────┐    ┌──────────────────────────────┐
│  LOCAL WORKER (PC, tray service) │◄──►│  CLOUDFLARE R2 (object store)│
│  Drains queue · Calibre REST ·   │    │  /epubs · /snapshot · /catalog│
│  FanFicFare updates · X4 sync ·  │    └──────────────────────────────┘
│  snapshot+epub push · #date_read │                  ▲ HTTPS (egress=$0)
└──────────────────────────────────┘                  │
         ▲ HTTP (localhost)                            │
         ▼                                             │
┌──────────────────────────────────┐                  │
│  CALIBRE CONTENT SERVER (PC)     │                  │
│  metadata.db · epub files        │                  │
└──────────────────────────────────┘                  │
         ┌─────────────────────────────────────────────┘
         ▼
┌─────────────────────────────────────────────────────────────────────┐
│  READING DEVICES                                                     │
│  ├── Palma (PWA: snapshot from Railway, epubs from R2)              │
│  └── Xteink X4 (SD card transfer from PC, unchanged from FFF)       │
└─────────────────────────────────────────────────────────────────────┘
```

## Why this shape

- **Calibre stays source of truth.** Railway is a queue/relay, not a database. R2 is a delivery cache. Both can be wiped and rebuilt from Calibre.
- **Worker can be offline.** Queue items accumulate on Railway, drain when worker reconnects. PC sleep/restart/crash doesn't lose data.
- **PWA can be offline.** Snapshot cached in IndexedDB, epubs in CacheStorage, status updates queued locally and drained when network returns.
- **Extension uses authenticated browser session.** Bypasses the Cloudflare-blocks-FanFicFare problem on first-fetch entirely. FanFicFare still owns chapter-update detection.

## Two core flows

- **Capture:** extension on AO3 → `/api/queue` → worker → Calibre add + normalize → snapshot to R2 → devices see new books.
- **Status:** any client → `/api/status-updates` → worker writes `#readstatus` + `#date_read` → optional `/api/ao3-actions` for later AO3 sync via the extension banner.

See [docs/architecture.md](docs/architecture.md) for the full component
breakdown and data flows, and [docs/data-model.md](docs/data-model.md) for
the Calibre columns, Railway tables, and snapshot format.
