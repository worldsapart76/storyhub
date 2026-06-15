# Browser extension + bookmarklet

> Source: §4.1 (extension) and §4.2 (bookmarklet) of the original StoryHub
> design doc.

> **⚠ SUPERSEDED IN PART — the authority for the on-AO3 interaction model is the
> Calibre-removal redesign §12.1–12.2** (reconciled Phase P, 2026-06-15). The
> capture topology, badge set, and sync queue below are Calibre-era. Corrections,
> in force:
> - **No standalone "Add to StoryHub" button.** Capture = hooking AO3's native
>   **Mark for Later** (which toggles to **Mark as Read** once listed). The extension
>   *hooks AO3's real buttons and injects only DNF* (§12.2). DNF is the single
>   injected control.
> - **No FanFicFare anywhere** (hard rule). There is no first-fetch / epub fallback;
>   only complete works are ever added. An epub-fetch failure is surfaced, not
>   worked around by FanFicFare.
> - **No `/api/status-updates` and no `status_updates` table.** Status/favorite
>   changes are direct `UPDATE works` writes; the AO3 side-effects queue is
>   **`ao3_actions`** (`mark_read | bookmark | remove_bookmark`, bookmark
>   `{private:true}`), §12.2.
> - **Bookmark = Favorite, created in the background.** AO3's Bookmark button only
>   navigates to a form, so the extension **intercepts it and creates a private
>   bookmark via a background authenticated POST** (no navigation); it also passively
>   detects bookmarks you create through AO3's own form. Bookmarks are **always
>   private** (never a user choice). Any bookmark = Favorite.
> - **DNF also marks the work read on AO3** (AO3 has no DNF) → StoryHub `read_status=DNF`.
> - **Pending actions drain AUTOMATICALLY** on any AO3 page load — **no on-AO3 banner,
>   no one-tap Confirm.** Failures surface in the **Sync view** (failed `ao3_actions`),
>   never silently. (Replaces the "Pending AO3 actions banner" below.)
> - **Badge set:** N/A (not in library) vs **Unread | Read | DNF** + the orthogonal
>   Favorite ★. **No "Priority" badge** — Priority is a reading list now.
>
> The unwired Phase-P prototype of these controls lives at
> `pwa/src/components/ExtensionControls.tsx` (gallery → Surfaces → "Extension (on AO3)").

## 4.1 Browser extension [DECIDED]

Single codebase, manifests for:
- Chromium (Chrome, Edge, Brave) — desktop only
- Firefox — desktop + Android

### On the AO3 work page

> **SUPERSEDED:** see the §12.2 corrections at the top — no standalone Add button
> (Mark for Later captures), only DNF is injected, no `/api/status-updates`, and the
> pending-actions drain is automatic (no banner).

- **"Add to StoryHub" button** inline near the work title, next to AO3's native action buttons. Captures metadata from DOM + fetches epub via authenticated session + POSTs to `/api/queue`. Visual feedback: idle → loading → success / error. Shows "Already in your library" with current status if the story is already imported.
- **"DNF" button** in the same area. Always visible (no anti-misclick delay — distinct enough). On click:
  1. POSTs DNF status update to `/api/status-updates` with `source: extension_dnf_button`
  2. Fires AO3 mark-as-read POST in the same session — no `/api/ao3-actions` queue round-trip needed since the user is on AO3 right now
- **Mark-for-Later intercept** on the native MfL toggle:
  - On → dual-fire: native AO3 mark + POST to `/api/queue` to capture the story
  - Off → POST status update as Read with `source: extension_ao3_native_read`. AO3 already updated by the native toggle; no AO3 action queued.
- **Bookmark save detection** via webRequest listener on POST to `/works/{id}/bookmarks`. On success → POST status update as Favorite with `source: extension_ao3_native_favorite`. webRequest is more stable than DOM observation; it doesn't break when AO3 tweaks form UI.
- **Pending AO3 actions banner** at the top of any AO3 page when `/api/ao3-actions` has unprocessed items (e.g., status changes from dashboard or CB legacy that need to be reflected on AO3). One-tap confirm executes the actions in the same session.

### Badge on AO3 listings (search results, MfL list, bookmarks, History, work cards everywhere)

Three states the badge renders for any work_id visible on a page:

| State | Render |
|---|---|
| **N/A** | Distinct gray/outlined indicator. Story is NOT in the user's StoryHub library at all. |
| **Status badge** | Existing color-coded read status. Story IS in the library; this is its current status. Color scheme lifted from the existing Read Status Badge extension. **SUPERSEDED:** the set is now **Unread / Read / DNF** + the orthogonal Favorite ★ — **no "Priority"** (it's a reading list now, §8). |

Distinguishing N/A from Unread matters: Unread = "in your library, haven't
read yet" (a managed state); N/A = "not in your library at all" (different
situation, different action needed). The existing Read Status Badge extension
collapses these into "no badge / Unread" which is the confusion StoryHub fixes.

**No "Add to StoryHub" button on listing cards.** Card surfaces only render
the badge. Adding a story is always done from the work page itself.

### Snapshot caching strategy

- **Storage:** local IndexedDB cache of the snapshot (the SQLite file from R2). All badge rendering reads from this cache — no per-page or per-card Railway round-trip.
- **Refresh triggers:**
  1. Extension wakes (browser startup, install, after long idle)
  2. On every AO3 page load, extension hits `/api/snapshot/current` (tiny JSON: `{version, r2_url}`). If the local version differs, pull the new snapshot in the background.

Cheap (one small JSON call per AO3 page load), needs no push notification
infra, and guarantees any change made anywhere is reflected on the next AO3
page visit.

### Authentication

Auth token + Railway URL entered once during first-install setup. Stored in
extension storage. Used in every Railway request as
`Authorization: Bearer {token}`. See [../auth.md](../auth.md).

### One-time setup commands (in the extension's options page)

- **Initial setup** — auth token + Railway URL, validate connection
- **AO3 History backfill** — walks `/users/{you}/readings`, populates `#date_read` for matching books. Pause/resume capable.
- **Structural metadata backfill** — walks every existing library work's AO3 page, populates `#all_fandoms`, `#all_relationships`, `#all_characters`, `#maturity`. ~4 hours of polite scraping, pause/resume.
- **Marked-for-Later catch-up [DECIDED]** — walks current AO3 Marked-for-Later pages, captures each story not yet in StoryHub. Run once during setup. After this, real-time MfL intercept handles all future additions.

### Error handling

| Failure mode | Behavior |
|---|---|
| Epub download from AO3 fails | **SUPERSEDED:** no FanFicFare fallback (hard rule) — only complete works are added. Surface the failure for retry; do not add a work without its epub. |
| Railway POST fails (offline, server down) | Extension's local outbox queues the operation in IndexedDB. Retries on next page load or every N seconds. Indicator on extension icon (badge text shows pending count). |
| User logged out of AO3 | Epub fetch returns a login page → extension detects, prompts user to log in, doesn't post anything yet. |
| Story already in library | Button shows "Already in your library" with current status. No duplicate add. |
| Story already queued, not yet imported | Button shows "Queued — waiting to import." No duplicate. |
| DOM parse fails (AO3 structure changed) | Caught gracefully, logged, surfaces "Couldn't read this page — please report" to the user. Other features keep working. |

### Distribution

Manifest V3. Personal use only — installed unpacked from a folder in developer
mode. No store submission, no review process.

### Deferred to v2

- Per-card "Add to StoryHub" buttons on listing pages
- Series page bulk capture ("add all stories in this series")
- Author page bulk capture ("add all bookmarks from this author")
- Cross-tab sync (extension state updates across open AO3 tabs)
- Visual import-progress animation on badges as queued stories finish importing
- **Manual epub upload** in the dashboard PWA — drop-zone fallback for when AO3 or Railway is having a bad day. Runs the uploaded epub through normalization just like an extension-captured one.

## 4.2 Bookmarklet [DECIDED]

JavaScript snippet, stored as a browser bookmark. Activated from the URL bar on
mobile browsers that don't support extensions (mobile Chrome, mobile Safari,
mobile Edge).

Capabilities (subset of extension):
- Read work metadata from current page DOM
- Fetch epub using current page's authenticated session
- POST to `/api/queue`

Single-purpose: capture-to-StoryHub from a story page. Doesn't replace browsing
or other extension features — those happen in the dashboard PWA on mobile.
