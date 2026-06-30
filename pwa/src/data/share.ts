/* Web Share Target intake. The manifest registers /share as a GET share target
   (vite.config.ts), so the OS share sheet navigates the installed PWA to
   /share?title=…&text=…&url=… . Different platforms drop the link in different
   params (Android often puts it in `text`), so we scan all three for an AO3 work
   URL, strip /share from the address bar so a refresh can't re-fire it, and hand
   the link to the normal Add-by-URL flow (requestCapture). */

const WORK_URL_RE = /https?:\/\/[^\s]*archiveofourown\.org\/works\/\d+[^\s]*/i

export function consumeSharedUrl(): string | null {
  if (typeof location === 'undefined' || location.pathname !== '/share') return null
  const p = new URLSearchParams(location.search)
  const candidates = [p.get('url'), p.get('text'), p.get('title')].filter(Boolean) as string[]
  // Clean the address bar first so a reload (or a double-mount) can't re-trigger.
  history.replaceState(null, '', '/')
  for (const c of candidates) {
    const m = c.match(WORK_URL_RE)
    if (m) return m[0]
  }
  // No clean match — pass the first thing along so the server can 422 with a
  // clear "couldn't find a work id" rather than silently dropping the share.
  return candidates[0] ?? null
}
