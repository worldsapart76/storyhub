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
  // Capture, all in the content script (page context): create the queue item,
  // fetch the epub from AO3 (only the page context passes AO3's Cloudflare; a DNR
  // rule injects the CORS header so we can read it), POST the bytes to Railway,
  // which stages + commits.
  async function doCapture() {
    const scraped = SH.ao3.scrapeWork()
    if (!scraped) {
      toast("Couldn't read this page — please report", 'err')
      return { ok: false }
    }
    const { payload } = scraped
    if (payload.is_complete === false) {
      toast('WIP — not added (only complete works are added)', 'warn')
      return { ok: false, skipped: 'incomplete' }
    }
    if (!payload.epub_url) {
      toast('No EPUB download link found', 'err')
      return { ok: false }
    }
    toast('Capturing…')
    try {
      const created = await SH.api.capture(payload)
      const qid = created.queue_item.queue_item_id
      // Hit the download subdomain directly (skip the main-domain 301);
      // credentials:'include' sends AO3/Cloudflare cookies.
      const dlUrl = payload.epub_url.replace(
        /^https:\/\/archiveofourown\.org\//,
        'https://download.archiveofourown.org/'
      )
      const epubRes = await fetch(dlUrl, { credentials: 'include' })
      if (!epubRes.ok) {
        toast(`Epub fetch → ${epubRes.status}`, 'err')
        return { ok: false }
      }
      const bytes = await epubRes.arrayBuffer()
      const item = await SH.api.uploadEpub(qid, bytes)
      if (item.state === 'failed') {
        toast('Commit failed: ' + (item.error || '?'), 'err')
        return { ok: false }
      }
      await setEntry({ s: 'Unread', f: 0, a: 'live' }) // fresh import = Unread
      renderTitleBadge(await getEntry())
      toast(created.needs_review ? 'Captured — needs review in StoryHub' : 'Added to StoryHub', 'ok')
      return { ok: true, needsReview: created.needs_review }
    } catch (e) {
      console.warn('[StoryHub] capture failed:', e.message)
      toast('Capture failed: ' + e.message, 'err')
      return { ok: false }
    }
  }

  async function markRead() {
    if (!(await getEntry())) {
      const cap = await doCapture() // pre-existing MfL work not yet in StoryHub
      if (!cap.ok || cap.needsReview) return
    }
    try {
      await SH.api.patchWork(workId, { read_status: 'Read', date_read: new Date().toISOString() })
      await setEntry({ s: 'Read' })
      renderTitleBadge(await getEntry())
      toast('Marked Read', 'ok')
    } catch (e) {
      toast('Update failed: ' + e.message, 'err')
    }
  }

  async function markUnread() {
    // Already in library + native Mark-for-Later clicked = deliberate re-mark (§12.2).
    try {
      await SH.api.patchWork(workId, { read_status: 'Unread' })
      await setEntry({ s: 'Unread' })
      renderTitleBadge(await getEntry())
      toast('Marked for Later', 'ok')
    } catch (e) {
      toast('Update failed: ' + e.message, 'err')
    }
  }

  // Mirror AO3's own Mark-for-Later <-> Mark-as-Read toggle on the button_to form.
  function toggleMarkForm(form, toRead) {
    if (!form) return
    const btn = form.querySelector('button[type="submit"], button')
    if (btn) btn.textContent = toRead ? 'Mark as Read' : 'Mark for Later'
    form.setAttribute('action', `/works/${workId}/${toRead ? 'mark_as_read' : 'mark_for_later'}`)
  }

  async function onMarkForLater(form) {
    if (await getEntry()) await markUnread() // re-mark a library work (deliberate Unread)
    else if (!(await doCapture()).ok) return // capture a new work
    SH.ao3.markForLater(workId).catch(() => {}) // AO3 side-effect (we prevented the native nav)
    toggleMarkForm(form, true)
  }

  async function onMarkAsRead(form) {
    await markRead()
    SH.ao3.markAsRead(workId).catch(() => {})
    toggleMarkForm(form, false)
  }

  async function onDnf() {
    if (!(await getEntry())) {
      const cap = await doCapture()
      if (!cap.ok) return
      if (cap.needsReview) {
        toast('Captured — set DNF after review', 'warn')
        return
      }
    }
    try {
      await SH.api.patchWork(workId, { read_status: 'DNF' })
    } catch (e) {
      toast('DNF failed: ' + e.message, 'err')
      return
    }
    await setEntry({ s: 'DNF' })
    renderTitleBadge(await getEntry())
    const btn = document.querySelector('.sh-dnf')
    if (btn) btn.disabled = true
    // AO3 end-state: marked read (best-effort; StoryHub DNF is authoritative).
    SH.ao3.markAsRead(workId).catch(() => {})
    toast('DNF', 'ok')
  }

  // AO3 renders Mark-for-Later / Mark-as-Read as button_to <form>s. Intercept the
  // form SUBMIT in the capture phase + stopImmediatePropagation so the native POST
  // never navigates (which would abort our async capture); we perform the AO3
  // side-effect ourselves via same-origin PATCH.
  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target
      if (!(form instanceof HTMLFormElement)) return
      const action = form.getAttribute('action') || form.action || ''
      const m = action.match(/\/works\/(\d+)\/(mark_for_later|mark_as_read)/)
      if (!m || Number(m[1]) !== workId) return
      e.preventDefault()
      e.stopImmediatePropagation()
      if (m[2] === 'mark_for_later') onMarkForLater(form)
      else onMarkAsRead(form)
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
    log('work.js ready · work', workId, '·', entry || 'not in library')
  }

  init()
})()
