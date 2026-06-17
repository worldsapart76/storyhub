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

  function epubUrl() {
    const a = document.querySelector('a[href*="/downloads/"][href*=".epub"]')
    if (!a) return null
    return new URL(a.getAttribute('href'), ORIGIN).href
  }

  /* Parse "5/10" | "1/1" | "3/?" -> { chapter_count, is_complete }. */
  function parseChapters(s) {
    const m = (s || '').match(/(\d+)\s*\/\s*(\d+|\?)/)
    if (!m) return { chapter_count: null, is_complete: null }
    const posted = Number(m[1])
    const total = m[2] === '?' ? null : Number(m[2])
    return { chapter_count: total || posted, is_complete: total != null && posted === total }
  }

  /* Build the RawCapture payload from the work-page DOM (raw, AO3 order). Returns
     null if the meta block isn't present (not a work page / DOM changed). */
  function scrapeWork() {
    const work_id = workIdFromUrl()
    const meta = document.querySelector('dl.work.meta.group')
    if (!work_id || !meta) return null

    // Read the title EXCLUDING any StoryHub badge we injected into the heading
    // (clone + strip, else the title captures "…◆N/A").
    const titleEl =
      document.querySelector('.preface .title.heading') ||
      document.querySelector('h2.title.heading')
    let title = ''
    if (titleEl) {
      const clone = titleEl.cloneNode(true)
      clone.querySelectorAll('.sh-titlebadge').forEach((n) => n.remove())
      title = clone.textContent.trim()
    }
    const authors = list('.preface .byline.heading a[rel="author"]')
    const summaryEl = document.querySelector('.preface .summary blockquote.userstuff') ||
      document.querySelector('.summary.module blockquote.userstuff')

    const stats = document.querySelector('dl.stats')
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
        // Railway fetches the epub server-side from this URL (AO3's Cloudflare
        // blocks the browser-extension fetch).
        epub_url: epubUrl(),
      },
    }
  }

  /* Same-origin authenticated request to an AO3 action route. AO3 renders these as
     Rails button_to forms (method=post + _method=patch), so the real verb is PATCH;
     we send it directly with the page CSRF token. Returns true on a 2xx (fetch
     follows AO3's 302 → 200). Best-effort: the caller logs failures. */
  async function action(path) {
    const token = csrfToken()
    const res = await fetch(`${ORIGIN}${path}`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: token ? { 'X-CSRF-Token': token } : {},
    })
    return res.ok
  }

  SH.ao3 = {
    workIdFromUrl,
    csrfToken,
    epubUrl,
    scrapeWork,
    markForLater: (id) => action(`/works/${id}/mark_for_later`),
    markAsRead: (id) => action(`/works/${id}/mark_as_read`),
  }
})()
