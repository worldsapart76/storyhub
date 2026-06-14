# StoryHub

A personal-use library manager and discovery layer for AO3 fan fiction.

StoryHub is the successor to FanFictionFlow (FFF). It absorbs the old
orchestrator's job — sync AO3 → Calibre → reading devices — and adds a
tag-aware browsing/discovery layer that AO3 itself doesn't provide for
Marked-for-Later stories.

Where FFF was a local tkinter app batch-processing CSV files, StoryHub is a
distributed system:

- a **browser extension** on AO3 doing real-time capture,
- a **Railway** cloud hub holding queues + snapshots,
- a headless **local worker** on the PC driving Calibre + FanFicFare,
- a **PWA dashboard** serving browsing/management from any device,
- **Cloudflare R2** for epub + snapshot delivery (zero egress).

Calibre stays the source of truth. Railway is a queue/relay; R2 is a delivery
cache. Both can be wiped and rebuilt from Calibre.

## What StoryHub is NOT

- Not a replacement for Calibre — Calibre stays source of truth.
- Not a replacement for FanFicFare — still used for chapter-update detection on existing stories.
- Not a public service — single-user, token-auth, free `*.railway.app` subdomain.
- Not a manga/non-AO3 reader. AO3-only.

## Repo layout

```
StoryHub/
├── CLAUDE.md            session guide (read first)
├── ARCHITECTURE.md      short overview, points at docs/
├── docs/                full design, decomposed by topic
│   ├── components/      per-component specs
│   ├── ux/              dashboard PWA surfaces
│   ├── lifted-from-fff/ institutional knowledge preserved from FFF
│   └── v2-deferred/     parked-for-v2 designs
├── worker/              Python service (Windows tray)
├── extension/           browser extension (Chromium + Firefox)
├── railway/             cloud hub service code
├── pwa/                 dashboard PWA
└── bookmarklet/         single-file mobile capture fallback
```

## Status

Scaffold stage: docs + skeleton, no code yet. Phase 0 (user-side
infrastructure) is complete. Code work begins at Phase 1. See
[docs/build-phases.md](docs/build-phases.md).
