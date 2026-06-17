/* Shared StoryHub badge element builder, used by listing cards (content/badges.js)
   and the work page (content/work.js). entry is the cached badge-map value
   {s:read_status, f:0|1, a:availability} or null (not in the library → N/A).
   Mirrors the Phase-P design (◆ mark + pill + amber ★). */
(function () {
  const SH = (globalThis.SH = globalThis.SH || {})

  function make(entry, opts) {
    const listing = opts && opts.listing
    const wrap = document.createElement('span')
    wrap.className = 'sh-titlebadge ' + (listing ? 'sh-listbadge' : 'sh-workbadge')

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

  SH.badge = { make }
})()
