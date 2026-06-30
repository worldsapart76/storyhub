/* E3a — AO3 work-page controls (redesign §12.1–12.2). Hooks AO3's own buttons and
   injects only DNF:
     - Mark for Later  -> capture (scrape + epub -> /api/queue) if not in library;
                          re-mark (Unread) if already in library
     - Mark as Read    -> read_status=Read (+ date_read)
     - DNF (injected)  -> capture-if-needed + read_status=DNF + AO3 mark-read
   Plus the StoryHub status badge beside the title. Epub bytes are fetched here
   (the AO3 session cookie is same-origin only) then handed to the background
   worker, which does the hub POSTs + R2 PUT. Status PATCHes go straight to the
   hub (CORS *). Bookmark -> Favorite is E3b. */
(function () {
  const SH = globalThis.SH
  const log = (...a) => console.info('[StoryHub]', ...a)

  if (!/^\/works\/\d+/.test(location.pathname)) return
  const workId = SH.ao3.workIdFromUrl()
  if (!workId) return

  // ---- local (optimistic) state in the cached badge map ----
  async function getEntry() {
    return (await SH.storage.getBadgeMap())[workId] || null
  }
  async function setEntry(patch) {
    const map = await SH.storage.getBadgeMap()
    map[workId] = { ...(map[workId] || { s: 'Unread', f: 0, a: 'live' }), ...patch }
    await SH.storage.setBadgeMap(map) // fires storage.onChanged -> re-render
    // Every setEntry follows a committed Postgres change (capture/status), so ask
    // the SW to (debounced) rebuild the snapshot — the local badge already updated
    // optimistically; this propagates to the PWA / other devices.
    chrome.runtime.sendMessage({ type: 'scheduleRebuild' }).catch(() => {})
    return map[workId]
  }

  // ---- UI ----
  function renderTitleBadge(entry) {
    const title =
      document.querySelector('.preface .title.heading') ||
      document.querySelector('h2.title.heading')
    if (!title) return
    const prev = title.querySelector(':scope > .sh-workbadge')
    if (prev) prev.remove()
    title.appendChild(SH.badge.make(entry, { listing: false }))
  }

  function injectDnf(entry) {
    const actions = document.querySelector('ul.work.navigation.actions')
    if (!actions || actions.querySelector('.sh-dnf-li')) return
    const li = document.createElement('li')
    li.className = 'sh-dnf-li'
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.className = 'sh-dnf'
    btn.innerHTML = '<span class="sh-mark" aria-hidden="true">◆</span> DNF'
    btn.disabled = !!(entry && entry.s === 'DNF')
    btn.addEventListener('click', onDnf)
    li.appendChild(btn)
    actions.appendChild(li)
  }

  let toastEl
  function toast(msg, kind) {
    if (!toastEl) {
      toastEl = document.createElement('div')
      document.body.appendChild(toastEl)
    }
    toastEl.textContent = msg
    toastEl.className = 'sh-toast sh-toast--show' + (kind ? ' sh-toast--' + kind : '')
    clearTimeout(toastEl._t)
    toastEl._t = setTimeout(() => (toastEl.className = 'sh-toast'), 4000)
  }

  // ---- actions ----
  // Capture the LIVE work into the unified queue via the shared capture path
  // (lib/capture.js) — same scrape → held capture → page-context epub fetch → upload
  // used by the Marked-for-Later bulk import. NOTHING commits here; it commits later
  // from the PWA Pending page (after the Review Queue picks primaries if ambiguous).
  async function doCapture() {
    toast('Queueing…')
    try {
      const r = await SH.capture.captureFromDoc(document, workId, { onProgress: (m) => toast(m) })
      if (r.skipped) { toast('WIP — not added (only complete works are added)', 'warn'); return { ok: false, skipped: 'incomplete' } }
      if (!r.ok) { toast('Capture failed: ' + r.reason, 'err'); return { ok: false } }
      toast('Queued: Add', 'ok')
      if (globalThis.SH.drawer) globalThis.SH.drawer.refresh()
      return { ok: true }
    } catch (e) {
      console.warn('[StoryHub] capture queue failed:', e.message)
      toast('Queue failed: ' + e.message, 'err')
      return { ok: false }
    }
  }

  // ---- queue actions (pending-queue redesign) -----------------------------
  // Every AO3 action becomes a pending item; NOTHING is performed on AO3 or written
  // to the library here. The AO3 side applies later from the drawer, the library
  // side from the PWA Pending page. No instant badge / button change, just a toast.
  const QUEUE_LABEL = {
    capture: 'Add', mark_read: 'Mark Read', mark_unread: 'Mark for Later',
    mark_dnf: 'Mark DNF', favorite: 'Favorite', unfavorite: 'Un-favorite',
  }
  async function queueAction(action) {
    let title = null
    let author = null
    const scraped = SH.ao3.scrapeWork()
    if (scraped && scraped.payload) {
      title = scraped.payload.title || null
      author = (scraped.payload.authors && scraped.payload.authors[0]) || null
    }
    try {
      await SH.api.createPending({ work_id: workId, action, origin: 'ao3', title, author })
      toast(`Queued: ${QUEUE_LABEL[action]}`, 'ok')
      if (globalThis.SH.drawer) globalThis.SH.drawer.refresh()
    } catch (e) {
      toast(`Queue failed: ${e.message}`, 'err')
    }
  }

  // Mark for Later: re-mark an in-library work Unread, else capture a new one.
  // (Capture still uses the old commit flow in this chunk; it moves into the queue
  // next chunk — epub staging + Review Queue.)
  async function onMarkForLater() {
    log('mark_for_later intercepted')
    if (await getEntry()) await queueAction('mark_unread')
    else await doCapture()
  }
  async function onMarkAsRead() {
    log('mark_as_read intercepted')
    await queueAction('mark_read')
  }

  // AO3's actual bookmark state (DOM-seeded at init) routes the Bookmark button
  // between queueing a favorite vs an un-favorite.
  let hasAo3Bookmark = false

  async function onCreateFavorite() {
    await queueAction('favorite')
  }
  async function onUnfavorite() {
    // Un-favorite removes the AO3 bookmark when applied — guard it (hard rule).
    if (!window.confirm('Queue un-favoriting this work? Removes its private AO3 bookmark when applied.')) return
    await queueAction('unfavorite')
  }
  async function onDnf() {
    await queueAction('mark_dnf')
  }

  // AO3 renders Mark-for-Later as a button_to <form> but Mark-as-Read as a
  // rails-ujs <a data-method="patch">, so intercept BOTH: the form SUBMIT and an
  // anchor CLICK, each in the capture phase + stopImmediatePropagation so neither
  // the native POST nor rails-ujs navigates/AJAXes (which would abort our async
  // capture). We perform the AO3 side-effect ourselves. The two never double-fire:
  // a form's submit button is a <button> (not an <a>), so the anchor handler skips
  // it; an anchor fires only click, no submit.
  const MARK_RE = /\/works\/(\d+)\/(mark_for_later|mark_as_read)/
  function dispatchMark(m, control) {
    if (m[2] === 'mark_for_later') onMarkForLater(control)
    else onMarkAsRead(control)
  }
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target
      if (!(form instanceof HTMLFormElement)) return
      const m = (form.getAttribute('action') || form.action || '').match(MARK_RE)
      if (!m || Number(m[1]) !== workId) return
      e.preventDefault()
      e.stopImmediatePropagation()
      dispatchMark(m, form)
    },
    true
  )
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest && e.target.closest('a[href]')
      if (!a) return
      const m = (a.getAttribute('href') || '').match(MARK_RE)
      if (!m || Number(m[1]) !== workId) return
      e.preventDefault()
      e.stopImmediatePropagation()
      dispatchMark(m, a)
    },
    true
  )

  // AO3's Bookmark / Edit Bookmark button (a.bookmark_form_placement_open) reveals
  // an inline form; intercept it. If AO3 already has a bookmark -> remove (guarded
  // un-favorite); else -> create an always-private bookmark (= Favorite).
  document.addEventListener(
    'click',
    (e) => {
      const a = e.target.closest && e.target.closest('a.bookmark_form_placement_open')
      if (!a) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (hasAo3Bookmark) onUnfavorite()
      else onCreateFavorite()
    },
    true
  )

  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== 'local' || !c.badgeMap) return
    const entry = (c.badgeMap.newValue || {})[workId] || null
    renderTitleBadge(entry)
    const btn = document.querySelector('.sh-dnf')
    if (btn) btn.disabled = !!(entry && entry.s === 'DNF')
  })

  async function init() {
    if (!(await SH.storage.isConfigured())) return
    const entry = await getEntry()
    renderTitleBadge(entry)
    injectDnf(entry)
    // Refresh the badge from the latest committed snapshot. Cheap when nothing
    // changed (sync only downloads if the version bumped); when a status/favorite
    // was applied in the PWA it lands here on the next AO3 visit. The resulting
    // setBadgeMap fires storage.onChanged above, which re-renders the badge.
    chrome.runtime.sendMessage({ type: 'sync' }).catch(() => {})
    // Cache the AO3 pseud id from the inline bookmark form so the drawer can
    // apply a queued favorite (bookmark) from any page.
    const pseudEl = document.querySelector('#bookmark_pseud_id')
    if (pseudEl && pseudEl.value) SH.storage.setPseudId(pseudEl.value)
    // Seed bookmark state from AO3's actual DOM (button reflects AO3, not StoryHub).
    hasAo3Bookmark = !!SH.ao3.bookmarkIdFromDom()
    log('work.js ready · work', workId, '·', entry || 'not in library', '· bookmarked:', hasAo3Bookmark)
  }

  init()
})()
