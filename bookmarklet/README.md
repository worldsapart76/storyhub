# bookmarklet/

A single JavaScript snippet stored as a browser bookmark — the mobile capture
fallback for browsers that can't run the extension (mobile Chrome, Safari,
Edge). Reads work metadata from the current AO3 page, fetches the epub via the
page's authenticated session, and POSTs to `/api/queue`. The auth token is
embedded in the snippet.

Single-purpose: capture-to-StoryHub from a story page. Browsing on mobile
happens in the PWA, not here.

**No code yet** — scaffold stage. Finalized + documented in Phase 8.

Spec: [../docs/components/extension.md](../docs/components/extension.md) (§4.2).
