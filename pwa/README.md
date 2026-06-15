# pwa/

The dashboard Progressive Web App. Single codebase serving all devices
(desktop, Palma, iPad, mobile). Browse / Saved Filters / Reading Lists / Review
Queue / Sync / Settings. Reads the snapshot from R2, filters client-side in
IndexedDB, offline-capable via service worker + CacheStorage.

Framework: **React + Vite + TypeScript** (decided 2026-06-14).

## Current state: Phase P design prototype (UNWIRED)

This holds the **unwired design prototype** (redesign §13 Phase P) — real
components built on **mock data only** (no API, no real epubs). It is the future
Phase F scaffold but stays unwired until design sign-off.

```
npm install
npm run dev      # http://localhost:5173 — component + surface gallery
npm run build    # type-check + bundle (keep green)
```

The dev entry is a **gallery harness** (`src/gallery/`) with Viewport
(Desktop/Tablet/Phone) and Theme (Light/Dark) toggles — not the real app shell yet.

Layout:
- `src/styles/tokens.css` — design tokens (the global tweak surface)
- `src/components/` — the component kit (+ co-located CSS)
- `src/gallery/` — the review harness (registry, device frames, pages)
- `src/mock/data.ts` — fixture data shaped like the snapshot projection (§12.3)

**Full handoff + progress + decisions:** [../docs/phase-p-prototype.md](../docs/phase-p-prototype.md).
Specs: [../docs/ux/](../docs/ux/) (start with
[pwa-shell.md](../docs/ux/pwa-shell.md)); forward design:
[../docs/calibre-removal-redesign.md](../docs/calibre-removal-redesign.md).
