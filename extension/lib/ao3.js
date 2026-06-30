/* AO3 page reading + same-origin actions (content-script context only — needs
   the page's DOM and SameSite session cookie). Scrapes the raw work metadata for
   /api/queue (§12.1, no normalization) and performs AO3 side-effects (mark for
   later / mark as read) via authenticated same-origin POSTs with the page CSRF
   token. Used by content/work.js (E3) and the ao3_actions drain (E4). */
(function () {
  const SH = (globalThis.SH = globalThis.SH || {})
  const ORIGIN = 'https://archiveofourown.org'

  const txt = (el) => (el ? el.textContent.trim() : '')
  const list = (sel, root) =>
    Array.from((root || document).querySelectorAll(sel))
      .map((e) => e.textContent.trim())
      .filter(Boolean)

  function workIdFromUrl() {
    const m = location.pathname.match(/^\/works\/(\d+)/)
    return m ? Number(m[1]) : null
  }

  function csrfToken() {
    const meta = document.querySelector('meta[name="csrf-token"]')
    return meta ? meta.getAttribute('content') : null
  }

  function epubUrlFromDoc(doc) {
    const a = doc.querySelector('a[href*="/downloads/"][href*=".epub"]')
    if (!a) return null
    return new URL(a.getAttribute('href'), ORIGIN).href
  }
  function epubUrl() {
    return epubUrlFromDoc(document)
  }

  /* Parse "5/10" | "1/1" | "3/?" -> { chapter_count, is_complete }. */
  function parseChapters(s) {
    const m = (s || '').match(/(\d+)\s*\/\s*(\d+|\?)/)
    if (!m) return { chapter_count: null, is_complete: null }
    const posted = Number(m[1])
    const total = m[2] === '?' ? null : Number(m[2])
    return { chapter_count: total || posted, is_complete: total != null && posted === total }
  }

  /* Build the RawCapture payload from a work-page Document (raw, AO3 order). Works
     on the LIVE document (scrapeWork) or a FETCHED+parsed one (bulk capture), so the
     single-work and Marked-for-Later bulk paths share one scrape. Returns null if the
     meta block isn't present (not a work page / adult interstitial / DOM changed). */
  function scrapeWorkDoc(doc, work_id) {
    const meta = doc.querySelector('dl.work.meta.group')
    if (!work_id || !meta) return null

    // Read the title EXCLUDING any StoryHub badge we injected into the heading
    // (clone + strip, else the title captures "…◆N/A"). Harmless on a fetched doc.
    const titleEl =
      doc.querySelector('.preface .title.heading') ||
      doc.querySelector('h2.title.heading')
    let title = ''
    if (titleEl) {
      const clone = titleEl.cloneNode(true)
      clone.querySelectorAll('.sh-titlebadge').forEach((n) => n.remove())
      title = clone.textContent.trim()
    }
    const authors = list('.preface .byline.heading a[rel="author"]', doc)
    const summaryEl = doc.querySelector('.preface .summary blockquote.userstuff') ||
      doc.querySelector('.summary.module blockquote.userstuff')

    const stats = doc.querySelector('dl.stats')
    const wordsRaw = txt(stats && stats.querySelector('dd.words')).replace(/[^\d]/g, '')
    const chap = parseChapters(txt(stats && stats.querySelector('dd.chapters')))

    const seriesA = meta.querySelector('dd.series a[href*="/series/"]')
    const seriesPos = txt(meta.querySelector('dd.series .position'))
    const seriesIdx = seriesPos.match(/Part\s+(\d+)/i)

    return {
      payload: {
        work_id,
        source: 'ao3',
        source_url: `${ORIGIN}/works/${work_id}`,
        title,
        summary_html: summaryEl ? summaryEl.innerHTML.trim() : null,
        fandoms: list('dd.fandom.tags a.tag', meta),
        relationships: list('dd.relationship.tags a.tag', meta),
        characters: list('dd.character.tags a.tag', meta),
        warnings: list('dd.warning.tags a.tag', meta),
        freeform_tags: list('dd.freeform.tags a.tag', meta),
        rating: txt(meta.querySelector('dd.rating.tags a.tag')) || null,
        wordcount: wordsRaw ? Number(wordsRaw) : null,
        chapter_count: chap.chapter_count,
        is_complete: chap.is_complete,
        series_name: seriesA ? txt(seriesA) : null,
        series_index: seriesIdx ? Number(seriesIdx[1]) : null,
        language: txt(meta.querySelector('dd.language')) || null,
        authors,
        epub_url: epubUrlFromDoc(doc),
      },
    }
  }

  /* Scrape the LIVE work page (work.js capture path). */
  function scrapeWork() {
    return scrapeWorkDoc(document, workIdFromUrl())
  }

  /* Same-origin authenticated request to an AO3 action route. AO3 renders these as
     Rails `button_to` forms — which submit as a POST carrying `_method=patch` and
     the `authenticity_token` in the BODY, NOT a raw HTTP PATCH. A raw PATCH gets
     its CSRF check rejected (Rails nulls the session → the readings login filter
     fires AO3's "you don't have permission…" flash, which then shows on the user's
     next page load), so replicate the form exactly instead. Same mechanism as the
     working createBookmark / removeBookmark. Returns true on a 2xx (fetch follows
     AO3's 302 → 200). Best-effort: the caller logs failures. */
  /* Same-origin authenticated form POST with AO3 rate-limit (429) + transient 5xx
     retry (honoring Retry-After). On exhaustion a lingering 429 is thrown as
     'RATE_LIMIT' so bulk callers can STOP the batch and resume later rather than
     keep hammering (which just extends the lockout); other failures return the
     response for the caller to inspect via res.ok. The X-CSRF-Token header is added
     from the page meta each attempt; pass authenticity_token in bodyParams where AO3
     expects it in the body (mark/delete forms). */
  async function _postForm(path, bodyParams) {
    const RETRYABLE = [429, 500, 502, 503, 504]
    const MAX = 4
    let res
    for (let attempt = 1; attempt <= MAX; attempt++) {
      const token = csrfToken()
      res = await fetch(`${ORIGIN}${path}`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          ...(token ? { 'X-CSRF-Token': token } : {}),
        },
        body: new URLSearchParams(bodyParams).toString(),
      })
      if (res.ok) return res
      if (!RETRYABLE.includes(res.status) || attempt === MAX) break
      const ra = parseInt(res.headers.get('Retry-After') || '', 10)
      await new Promise((r) => setTimeout(r, Math.min(Number.isFinite(ra) ? ra * 1000 : 8000 * attempt, 60000)))
    }
    if (res && res.status === 429) throw new Error('RATE_LIMIT')
    return res
  }

  async function action(path) {
    const res = await _postForm(path, { _method: 'patch', authenticity_token: csrfToken() || '' })
    if (!res.ok) console.warn('[StoryHub] ao3 action', path, '→', res.status)
    return res.ok
  }

  /* The AO3 default pseud id, needed to create a bookmark. The inline bookmark
     form is already in the work-page DOM (#bookmark_pseud_id); cache it so the
     drain can bookmark from any page, else fetch the new-bookmark form. */
  async function pseudId(workId) {
    const el = document.querySelector('#bookmark_pseud_id')
    if (el && el.value) {
      SH.storage.setPseudId(el.value)
      return el.value
    }
    const cached = await SH.storage.getPseudId()
    if (cached) return cached
    const res = await fetch(`${ORIGIN}/works/${workId}/bookmarks/new`, { credentials: 'same-origin' })
    if (res.ok) {
      const html = await res.text()
      const m = html.match(/name="bookmark\[pseud_id\]"[^>]*value="(\d+)"/) ||
        html.match(/value="(\d+)"[^>]*name="bookmark\[pseud_id\]"/)
      if (m) {
        SH.storage.setPseudId(m[1])
        return m[1]
      }
    }
    return null
  }

  /* Create an always-private bookmark (= Favorite, §12.2). Same-origin form POST
     with the page CSRF token. Returns true on 2xx. Idempotent: if a bookmark for
     this work already exists, skip creation (else a retry — e.g. favorite's
     mark-read half failing — would create a duplicate AO3 bookmark). */
  async function createBookmark(workId) {
    const existing = await bookmarkIdForWork(workId).catch(() => null)
    if (existing) return true
    const pid = await pseudId(workId)
    if (!pid) throw new Error('no pseud_id')
    const res = await _postForm(`/works/${workId}/bookmarks`, {
      'bookmark[pseud_id]': pid,
      'bookmark[bookmarker_notes]': '',
      'bookmark[tag_string]': '',
      'bookmark[collection_names]': '',
      'bookmark[private]': '1', // StoryHub bookmarks are always private
      'bookmark[rec]': '0',
      commit: 'Create',
    })
    return res.ok
  }

  /* The user's own bookmark id for this work, read from the work-page DOM (the
     bookmark form / edit link points at /bookmarks/{id}). Null if not bookmarked. */
  function bookmarkIdFromDom() {
    for (const el of document.querySelectorAll('[href*="/bookmarks/"],[action*="/bookmarks/"]')) {
      const ref = el.getAttribute('href') || el.getAttribute('action') || ''
      const m = ref.match(/\/bookmarks\/(\d+)(?:[/?]|$)/)
      if (m) return m[1]
    }
    return null
  }

  /* Resolve the bookmark id for a work. Only trust the live DOM when we're actually
     ON this work's page — bookmarkIdFromDom() scans the current page indiscriminately,
     so on ANY other page (another work, the readings/to-read list) it returns a
     DIFFERENT work's bookmark id. That false positive is load-bearing: createBookmark
     would think this work is already bookmarked and skip creation (favoriting never
     adds the AO3 bookmark), and removeBookmark would delete an UNRELATED bookmark. The
     drawer applies from whatever page is open, so off-page we must fetch + parse the
     work's own page instead. */
  async function bookmarkIdForWork(workId) {
    if (workIdFromUrl() === Number(workId)) {
      const fromDom = bookmarkIdFromDom()
      if (fromDom) return fromDom
    }
    const res = await fetch(`${ORIGIN}/works/${workId}`, { credentials: 'same-origin' })
    if (!res.ok) return null
    const m = (await res.text()).match(/\/bookmarks\/(\d+)(?:["'/?])/)
    return m ? m[1] : null
  }

  /* Remove the AO3 bookmark (= un-favorite). AO3 renders delete as a Rails
     button_to form (POST + _method=delete), so mimic that exactly rather than a
     raw DELETE verb. Returns true on 2xx. */
  async function removeBookmark(workId) {
    const id = await bookmarkIdForWork(workId)
    if (!id) throw new Error('bookmark id not found')
    const res = await _postForm(`/bookmarks/${id}`, { _method: 'delete', authenticity_token: csrfToken() || '' })
    if (!res.ok) console.warn('[StoryHub] removeBookmark', id, '→', res.status)
    return res.ok
  }

  /* The logged-in AO3 username, read from the page chrome (the greeting menu links
     to /users/{username}). Null if not logged in. */
  function currentUsername() {
    for (const a of document.querySelectorAll('#greeting a[href^="/users/"], #header a[href^="/users/"]')) {
      const m = (a.getAttribute('href') || '').match(/^\/users\/([^/?#]+)/)
      if (m) return decodeURIComponent(m[1])
    }
    return null
  }

  /* Fetch one readings page, retrying through AO3 rate-limiting (429) and transient
     5xx with backoff (honoring Retry-After when present). Throws after exhausting
     attempts so the caller can stop with partial results rather than spin forever. */
  async function _fetchReadingsDoc(url, onProgress) {
    const RETRYABLE = [429, 500, 502, 503, 504]
    const MAX_ATTEMPTS = 5
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      const res = await fetch(url, { credentials: 'same-origin' })
      if (res.ok) return new DOMParser().parseFromString(await res.text(), 'text/html')
      if (!RETRYABLE.includes(res.status) || attempt === MAX_ATTEMPTS) {
        throw new Error(String(res.status))
      }
      const ra = parseInt(res.headers.get('Retry-After') || '', 10)
      const waitMs = Math.min(Number.isFinite(ra) ? ra * 1000 : 30000 * attempt, 120000)
      if (onProgress) onProgress(`AO3 rate-limited (${res.status}); waiting ${Math.round(waitMs / 1000)}s… (try ${attempt}/${MAX_ATTEMPTS - 1})`)
      await new Promise((r) => setTimeout(r, waitMs))
    }
    throw new Error('retry exhausted')
  }

  /* Enumerate Marked-for-Later work ids via AO3's `readings?show=to-read` filter,
     which lists ONLY the marked-for-later works (not the whole reading history) —
     far fewer pages and every entry is already an MfL item, so no per-blurb marker
     check is needed.

     Dedup happens DURING the scan via opts.isDupe(id) (already in library / queued),
     which also powers early-stop: the list is newest-mark-first, so new (unimported)
     works sit at the top and the tail is almost all already-imported. opts.
     stopAfterDupePages > 0 stops once that many CONSECUTIVE pages yield zero new ids
     (a small tolerance against a fluke all-dupe page). 0 = scan the whole MfL list
     (the complete set, for an audit). opts.onProgress(msg) fires per page.

     Returns { newIds, mflTotal, dupeTotal, pagesScanned, stoppedEarly, incomplete,
     incompleteReason }. Counts are partial when stoppedEarly (intended) or incomplete
     (AO3 rate-limited past our backoff — we keep + return what we already collected,
     never throw it away). */
  async function fetchMarkedForLaterIds(opts = {}) {
    const {
      isDupe = () => false, stopAfterDupePages = 0, onProgress,
      startPage = 1, pageLimit = Infinity,
    } = opts
    const user = currentUsername()
    if (!user) throw new Error('Not logged in to AO3 (no username found on the page)')
    const newIds = []
    const allIds = [] // every MfL id seen this run (new + dupe) — for the audit
    const seen = new Set()
    let mflTotal = 0
    let dupeTotal = 0
    let sawAnyMfl = false
    let consecutiveNoNew = 0
    let stoppedEarly = false
    let incomplete = false
    let incompleteReason = ''
    let reachedEnd = false // saw a page with no "next" link → the true end of the list
    let pagesThisRun = 0
    let page = startPage
    let lastPage = startPage - 1
    const MAX_PAGES = 400 // safety stop; logged if hit (no silent cap)
    while (page <= MAX_PAGES && pagesThisRun < pageLimit) {
      const url = `${ORIGIN}/users/${encodeURIComponent(user)}/readings?show=to-read&page=${page}`
      let doc
      try {
        doc = await _fetchReadingsDoc(url, onProgress)
      } catch (e) {
        // Keep everything collected so far; report where we stopped.
        incomplete = true
        incompleteReason = `page ${page}: ${e.message}`
        break
      }
      pagesThisRun += 1
      lastPage = page
      const blurbs = doc.querySelectorAll('li.blurb, li.reading')
      let pageMfl = 0
      let pageNew = 0
      for (const li of blurbs) {
        // Every entry on the show=to-read view is a marked-for-later work — just take
        // its id (deleted/mystery blurbs without a /works/ link are skipped).
        const link = li.querySelector('h4.heading a[href*="/works/"], .header .heading a[href*="/works/"]')
        const m = link && (link.getAttribute('href') || '').match(/\/works\/(\d+)/)
        if (!m || seen.has(m[1])) continue
        seen.add(m[1])
        const id = Number(m[1])
        allIds.push(id)
        pageMfl += 1
        mflTotal += 1
        if (isDupe(id)) {
          dupeTotal += 1
        } else {
          newIds.push(id)
          pageNew += 1
        }
      }
      if (onProgress) {
        onProgress(`page ${page}: ${pageMfl} marked, ${pageNew} new (total new ${newIds.length})`)
      }
      // Early-stop (catch-up only): once we've entered the marked-for-later region,
      // stop after N consecutive pages that yield NO new ids. NOTE the list is ordered
      // by last-VIEWED, not by when added — so new items can be scattered; early-stop
      // is a fast heuristic for routine catch-up, while a full (paged) scan with
      // stopAfterDupePages=0 is what the audit uses for completeness.
      if (pageMfl > 0) sawAnyMfl = true
      if (stopAfterDupePages > 0 && sawAnyMfl) {
        if (pageNew === 0) {
          consecutiveNoNew += 1
          if (consecutiveNoNew >= stopAfterDupePages) { stoppedEarly = true; break }
        } else {
          consecutiveNoNew = 0
        }
      }
      const next = doc.querySelector('.pagination .next a, li.next a[href]')
      if (!next) { reachedEnd = true; break }
      page += 1
      if (pagesThisRun < pageLimit) {
        // Be polite to AO3 (it 429s on rapid paging): ~1s with jitter.
        await new Promise((r) => setTimeout(r, 900 + Math.floor(Math.random() * 400)))
      }
    }
    if (page > MAX_PAGES) {
      incomplete = true
      incompleteReason = `hit ${MAX_PAGES}-page cap`
      console.warn('[StoryHub] readings hit MAX_PAGES cap — more pages may remain')
    }
    // More pages remain unless we hit a page with no "next" link.
    const hasMore = !reachedEnd
    return {
      newIds, allIds, mflTotal, dupeTotal, pagesScanned: pagesThisRun, lastPage,
      hasMore, stoppedEarly, incomplete, incompleteReason,
    }
  }

  /* Enumerate the user's BOOKMARKED work ids via /users/{user}/bookmarks (every
     bookmark = Favorite, §12.2). Used by the one-time favorites reconciliation: AO3
     bookmarks were never reconciled at migration (favorites came from Calibre alone),
     so this scrapes the real bookmark set to backfill is_favorite.

     Chunked + resumable like the MfL audit (AO3 rate-limits long scans): pass
     startPage/pageLimit to do one chunk, persist lastPage, and continue. Only WORK
     bookmarks are collected — series/external-work bookmarks (no /works/ link) are
     skipped. Returns { allIds, pagesScanned, lastPage, hasMore, incomplete,
     incompleteReason }; collected ids are kept even when AO3 throttles mid-scan. */
  async function fetchBookmarkedIds(opts = {}) {
    const { onProgress, startPage = 1, pageLimit = Infinity } = opts
    const user = currentUsername()
    if (!user) throw new Error('Not logged in to AO3 (no username found on the page)')
    const allIds = []
    const seen = new Set()
    let incomplete = false
    let incompleteReason = ''
    let reachedEnd = false
    let pagesThisRun = 0
    let page = startPage
    let lastPage = startPage - 1
    const MAX_PAGES = 400 // safety stop; logged if hit (no silent cap)
    while (page <= MAX_PAGES && pagesThisRun < pageLimit) {
      const url = `${ORIGIN}/users/${encodeURIComponent(user)}/bookmarks?page=${page}`
      let doc
      try {
        doc = await _fetchReadingsDoc(url, onProgress)
      } catch (e) {
        incomplete = true
        incompleteReason = `page ${page}: ${e.message}`
        break
      }
      pagesThisRun += 1
      lastPage = page
      let pageWorks = 0
      for (const li of doc.querySelectorAll('li.bookmark.blurb, li.blurb')) {
        const link = li.querySelector('h4.heading a[href*="/works/"], .header .heading a[href*="/works/"]')
        const m = link && (link.getAttribute('href') || '').match(/\/works\/(\d+)/)
        if (!m || seen.has(m[1])) continue
        seen.add(m[1])
        allIds.push(Number(m[1]))
        pageWorks += 1
      }
      if (onProgress) onProgress(`page ${page}: ${pageWorks} bookmarks (total ${allIds.length})`)
      const next = doc.querySelector('.pagination .next a, li.next a[href]')
      if (!next) { reachedEnd = true; break }
      page += 1
      if (pagesThisRun < pageLimit) {
        await new Promise((r) => setTimeout(r, 900 + Math.floor(Math.random() * 400)))
      }
    }
    if (page > MAX_PAGES) {
      incomplete = true
      incompleteReason = `hit ${MAX_PAGES}-page cap`
      console.warn('[StoryHub] bookmarks hit MAX_PAGES cap — more pages may remain')
    }
    return {
      allIds, pagesScanned: pagesThisRun, lastPage,
      hasMore: !reachedEnd, incomplete, incompleteReason,
    }
  }

  const markForLater = (id) => action(`/works/${id}/mark_for_later`)
  const markAsRead = (id) => action(`/works/${id}/mark_as_read`)

  /* Reach the "read" end-state reliably: AO3's mark_as_read only works on a work
     that's in the Marked-for-Later list, so ensure it's listed first (idempotent),
     then mark it read. Returns the mark_as_read result. */
  async function markRead(id) {
    await markForLater(id).catch(() => {})
    return markAsRead(id)
  }

  /* Like markAsRead but returns {ok, status} so a bulk caller can tell a deleted
     work (404 → already off MfL, nothing to clear) from a real failure. Still throws
     'RATE_LIMIT' on an exhausted 429. */
  async function markAsReadResult(id) {
    const res = await _postForm(`/works/${id}/mark_as_read`, { _method: 'patch', authenticity_token: csrfToken() || '' })
    return { ok: res.ok, status: res ? res.status : 0 }
  }

  SH.ao3 = {
    workIdFromUrl,
    csrfToken,
    epubUrl,
    scrapeWork,
    scrapeWorkDoc,
    pseudId,
    createBookmark,
    bookmarkIdFromDom,
    removeBookmark,
    markForLater,
    markAsRead,
    markAsReadResult,
    markRead,
    currentUsername,
    fetchMarkedForLaterIds,
    fetchBookmarkedIds,
  }
})()
