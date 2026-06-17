/* E2 — badges on AO3 listings (docs/components/extension.md). For every work
   blurb on a listing page (search, Marked-for-Later, bookmarks, history, tag
   works, series, author works) render a badge from the cached badge map:
   N/A (outlined — not in the library) vs Unread/Read/DNF + the orthogonal ★.
   Reads only chrome.storage.local (no network, no WASM); the background worker
   keeps the map current. Work-page action controls are content/work.js. */
(function () {
  const SH = globalThis.SH
  const BADGE_CLASS = 'sh-listbadge'
  const log = (...a) => console.info('[StoryHub]', ...a)

  function workIdFromHead(head) {
    const a = head.querySelector('a[href*="/works/"]')
    if (!a) return null
    const m = a.getAttribute('href').match(/\/works\/(\d+)/)
    return m ? m[1] : null
  }

  function render(map) {
    const heads = document.querySelectorAll('li.blurb h4.heading')
    let badged = 0
    heads.forEach((head) => {
      const wid = workIdFromHead(head)
      if (!wid) return // series/other blurbs with no work link
      const prev = head.querySelector(':scope > .' + BADGE_CLASS)
      if (prev) prev.remove()
      head.appendChild(SH.badge.make(map[wid] || null, { listing: true }))
      badged++
    })
    if (heads.length) log(`listings: ${heads.length} blurbs, ${badged} badged`)
  }

  async function init() {
    if (!SH || !SH.storage) {
      log('ERROR: SH.storage missing — lib/storage.js did not load')
      return
    }
    if (!(await SH.storage.isConfigured())) return
    render(await SH.storage.getBadgeMap())
  }

  // Re-render in place when a background sync (or an optimistic work-page write)
  // refreshes the badge map.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.badgeMap) render(changes.badgeMap.newValue || {})
  })

  init()
})()
