/* E2 — badges on AO3 listings (docs/components/extension.md). For every work
   blurb on a listing page (search, Marked-for-Later, bookmarks, history, tag
   works, series, author works) render a badge from the cached badge map:
   N/A (outlined — not in the library) vs Unread/Read/DNF + the orthogonal ★.
   Reads only chrome.storage.local (no network, no WASM); the background worker
   keeps the map current. Work-page action controls are E3. */
(function () {
  const SH = globalThis.SH
  const BADGE_CLASS = 'sh-listbadge'
  const log = (...a) => console.info('[StoryHub]', ...a)
  log('badges.js loaded on', location.pathname)

  function workIdFromHead(head) {
    const a = head.querySelector('a[href*="/works/"]')
    if (!a) return null
    const m = a.getAttribute('href').match(/\/works\/(\d+)/)
    return m ? m[1] : null
  }

  function makeBadge(entry) {
    const wrap = document.createElement('span')
    wrap.className = 'sh-titlebadge ' + BADGE_CLASS

    const mark = document.createElement('span')
    mark.className = 'sh-mark'
    mark.setAttribute('aria-hidden', 'true')
    mark.textContent = '◆'
    wrap.appendChild(mark)

    const pill = document.createElement('span')
    if (!entry) {
      pill.className = 'sh-badge sh-badge--na'
      pill.textContent = 'N/A'
    } else {
      pill.className = 'sh-badge sh-badge--' + String(entry.s).toLowerCase()
      pill.textContent = entry.s
    }
    wrap.appendChild(pill)

    if (entry && entry.f) {
      const star = document.createElement('span')
      star.className = 'sh-fav'
      star.title = 'Favorite'
      star.textContent = '★'
      wrap.appendChild(star)
    }
    return wrap
  }

  function render(map) {
    const heads = document.querySelectorAll('li.blurb h4.heading')
    let badged = 0
    heads.forEach((head) => {
      const wid = workIdFromHead(head)
      if (!wid) return // series/other blurbs with no work link
      const prev = head.querySelector(':scope > .' + BADGE_CLASS)
      if (prev) prev.remove()
      head.appendChild(makeBadge(map[wid] || null))
      badged++
    })
    log(`render: ${heads.length} blurb headings, ${badged} badged`)
  }

  async function init() {
    if (!SH || !SH.storage) {
      log('ERROR: SH.storage missing — lib/storage.js did not load')
      return
    }
    const configured = await SH.storage.isConfigured()
    const map = await SH.storage.getBadgeMap()
    log('init: configured =', configured, '· badge map entries =', Object.keys(map).length)
    if (!configured) return
    render(map)
  }

  // Re-render in place when a background sync refreshes the badge map.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes.badgeMap) render(changes.badgeMap.newValue || {})
  })

  init()
})()
