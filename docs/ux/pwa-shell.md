# PWA shell + top-level views

> Source: §7.1 and §7.2 of the original StoryHub design doc. The Dashboard PWA
> is the primary iteration area; the rest of [.](.) covers each surface.

## 7.1 PWA shell requirements [DECIDED]

- Installable to Android/iOS home screen
- Service worker caches app shell + assets for offline launch
- IndexedDB stores current snapshot
- CacheStorage stores pinned epubs
- Background sync for queued status updates
- Auth token stored in IndexedDB on first setup
- Works in standard browser tab too (not installation-required)
- Cold start to interactive: target < 2s on Palma

Served from Railway. Single codebase, serves all devices. Replaces tkinter,
replaces CalibreFanFicBrowser.

**[OPEN] PWA framework:** React + Vite, SvelteKit, plain HTML+vanilla JS — all
viable. Decide during Phase 5 scaffold. Tracked in
[../open-questions.md](../open-questions.md).

## 7.2 Top-level views [DECIDED]

Persistent nav (sidebar on desktop, bottom tabs on mobile):

1. **Browse** — the landing view. CB-equivalent filters always visible (status, word count, search, sort); expandable surface adds category boxes for tags, date ranges, Reading List membership, author, etc. → [browse.md](browse.md)
2. **Saved Filters** — named presets of Browse filter state (filter + sort). Apply with one tap. Re-evaluate against current library state at view time. Starred ones surface as chips in Browse. → [saved-filters.md](saved-filters.md)
3. **Reading Lists** — hand-curated story lists (renamed from "Playlists"). Membership explicit and stable regardless of filters. Drag-drop reorder. Includes the built-in non-deletable Favorites list. → [reading-lists.md](reading-lists.md)
4. **Review Queue** — pending review-needed stories from imports. Only appears in nav when count > 0. → [review-queue.md](review-queue.md)
5. **Sync** — worker status, recent activity, manual triggers (Sync X4, run FanFicFare update check, etc.). → [sync-view.md](sync-view.md)
6. **Settings** — auth token, Calibre server URL, R2 endpoint config, scheduled job timings, **Tag Management** (favorite/normal/exclude + category). → [settings.md](settings.md)

(No **Stats** nav in v1 — entire analytics surface deferred to v2. See
[../v2-deferred/stats-analytics.md](../v2-deferred/stats-analytics.md).)

**No separate Quick Find view.** The Browse view in its default state IS the
quick-find experience — a prominent title/keyword search box and core filters
immediately at hand; tag-level depth is one expand-click away. Title/keyword
search is a first-class always-visible feature of Browse, not buried behind any
expansion.
