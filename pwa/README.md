# pwa/

The dashboard Progressive Web App. Single codebase serving all devices
(desktop, Palma, iPad, mobile). Browse / Saved Filters / Reading Lists / Review
Queue / Sync / Settings. Reads the snapshot from R2, filters client-side in
IndexedDB, offline-capable via service worker + CacheStorage.

**No code yet** — scaffold stage. First code lands in Phase 5 (basic) and
Phase 6 (full features).

Framework: **React + Vite** (decided 2026-06-14; with `vite-plugin-pwa` and
list virtualization for the ~7k-book result list) — see
[../docs/ux/pwa-shell.md](../docs/ux/pwa-shell.md).

Specs: [../docs/ux/](../docs/ux/) (start with
[pwa-shell.md](../docs/ux/pwa-shell.md)).
