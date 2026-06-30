/* Shared capture path (pending-queue redesign). One implementation of the
   LOAD-BEARING capture sequence — scrape → create held capture → fetch epub in the
   page context → upload — used by BOTH the single-work hook (content/work.js, live
   document) and the Marked-for-Later bulk import (content/drawer.js, fetched docs).
   Keeping it in one place stops the two paths from drifting.

   Why page-context fetch: AO3's Cloudflare blocks the epub download from the SW and
   from Railway; only a content-script fetch (residential IP + session) passes, with
   a DNR rule injecting CORS on download.archiveofourown.org. See the phase-e memory. */
(function () {
  const SH = (globalThis.SH = globalThis.SH || {})
  const ORIGIN = 'https://archiveofourown.org'

  /* AO3 generates the epub on demand — the first hit to the download subdomain often
     returns a transient 503 (or 429/502/504) while it builds, then succeeds on retry.
     Back off and retry those; give up on any other status. */
  async function fetchEpub(url, attempts = 3, onRetry) {
    let res
    for (let i = 0; i < attempts; i++) {
      res = await fetch(url, { credentials: 'include' })
      if (res.ok || ![429, 502, 503, 504].includes(res.status)) return res
      if (i < attempts - 1) {
        if (onRetry) onRetry(res.status)
        await new Promise((r) => setTimeout(r, 1500 * (i + 1)))
      }
    }
    return res
  }

  /* Same-origin GET of a work page with 429/5xx backoff (bulk import fetches many). */
  async function _getDoc(url) {
    const RETRYABLE = [429, 500, 502, 503, 504]
    for (let attempt = 1; attempt <= 4; attempt++) {
      const res = await fetch(url, { credentials: 'same-origin' })
      if (res.ok) return new DOMParser().parseFromString(await res.text(), 'text/html')
      if (!RETRYABLE.includes(res.status) || attempt === 4) throw new Error(String(res.status))
      const ra = parseInt(res.headers.get('Retry-After') || '', 10)
      await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(ra) ? ra * 1000 : 30000 * attempt, 120000)))
    }
    throw new Error('retry exhausted')
  }

  /* Capture a work into the pending queue from a (live or fetched) Document. Returns
     { ok, skipped, reason, pendingId }. skipped=true means a deliberate non-error
     skip (a WIP — only complete works are added, hard rule). */
  async function captureFromDoc(doc, workId, { onProgress } = {}) {
    const scraped = SH.ao3.scrapeWorkDoc(doc, workId)
    if (!scraped) return { ok: false, reason: 'unreadable (not a work page / adult gate)' }
    const { payload } = scraped
    if (payload.is_complete === false) return { ok: false, skipped: true, reason: 'WIP — only complete works are added' }
    if (!payload.epub_url) return { ok: false, reason: 'no epub download link' }
    const created = await SH.api.capturePending(payload)
    const dlUrl = payload.epub_url.replace(
      /^https:\/\/archiveofourown\.org\//,
      'https://download.archiveofourown.org/'
    )
    const epubRes = await fetchEpub(dlUrl, 3, (s) => onProgress && onProgress(`epub retry (${s})`))
    if (!epubRes.ok) {
      // The held capture row exists but has no epub yet — it'll show "epub still
      // uploading" in the queue and won't commit until re-captured.
      return { ok: false, reason: `epub fetch ${epubRes.status}`, pendingId: created.id }
    }
    await SH.api.uploadPendingEpub(created.id, await epubRes.arrayBuffer())
    return { ok: true, workId, pendingId: created.id }
  }

  /* Fetch a work page by id (forcing past the adult interstitial) then capture it.
     Used by the Marked-for-Later bulk import, which isn't on the work's own page. */
  async function captureWorkById(workId, opts = {}) {
    let doc
    try {
      doc = await _getDoc(`${ORIGIN}/works/${workId}?view_adult=true`)
    } catch (e) {
      return { ok: false, reason: `work page ${e.message}` }
    }
    return captureFromDoc(doc, workId, opts)
  }

  SH.capture = { fetchEpub, captureFromDoc, captureWorkById }
})()
