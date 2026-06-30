/* StoryHub on-AO3 queue drawer (pending-queue redesign). A slide-out panel on every
   AO3 page showing the unified pending queue. "Apply to AO3" performs each item's
   AO3 side-effect (same-origin, this page's session) and acks it; per-item Cancel
   drops it. The library side is applied separately from the PWA Pending page.

   Replaces the old auto-drain (content/drain.js) — nothing is performed until the
   user explicitly applies here, so AO3 changes are visible + controllable. */
(function () {
  const SH = (globalThis.SH = globalThis.SH || {})
  const log = (...a) => console.info('[StoryHub]', ...a)

  const QUEUE_LABEL = {
    capture: 'Add', mark_read: 'Mark Read', mark_unread: 'Mark for Later',
    mark_dnf: 'Mark DNF', favorite: 'Favorite', unfavorite: 'Un-favorite',
  }
  // The AO3 side-effect each action implies (performed from this page's session).
  const AO3_APPLY = {
    mark_read: (w) => SH.ao3.markRead(w),
    mark_unread: (w) => SH.ao3.markForLater(w),
    mark_dnf: (w) => SH.ao3.markRead(w),       // AO3 has no DNF — mark read
    // Favorite = private bookmark + read (§12.2): the library side sets
    // read_status=Read, so the AO3 side must also mark read (else the work lingers
    // in Marked-for-Later). createBookmark is idempotent, so a retry is safe.
    favorite: async (w) => {
      const bm = await SH.ao3.createBookmark(w)
      const rd = await SH.ao3.markRead(w)
      return bm && rd
    },
    unfavorite: (w) => SH.ao3.removeBookmark(w),
    capture: (w) => SH.ao3.markForLater(w),
  }
  // How each applied action changes AO3 Marked-for-Later membership, so the normal
  // queue keeps the audit snapshot (AUDIT_KEY) consistent with what it did to AO3 —
  // otherwise the audit keeps reporting works this queue already cleared/added.
  // 'remove' = marked read (off to-read); 'add' = back on to-read. unfavorite only
  // drops the bookmark, which doesn't touch to-read membership.
  const AO3_TOREAD_EFFECT = {
    mark_read: 'remove', mark_dnf: 'remove', favorite: 'remove',
    mark_unread: 'add', capture: 'add',
  }

  let items = []
  let open = false
  let busy = false

  // ---- DOM ----
  const tab = document.createElement('button')
  tab.className = 'sh-drawer-tab'
  tab.type = 'button'

  const panel = document.createElement('aside')
  panel.className = 'sh-drawer'
  panel.innerHTML =
    '<div class="sh-drawer__head">' +
    '<span class="sh-drawer__title">StoryHub Queue</span>' +
    '<button type="button" class="sh-drawer__close" aria-label="Close">×</button>' +
    '</div>' +
    '<div class="sh-drawer__catchup">' +
    '<button type="button" class="sh-drawer__catchupbtn">Catch up from Marked for Later</button>' +
    '<label class="sh-drawer__catchupopt">' +
    '<input type="checkbox" class="sh-drawer__catchupstop" checked> Stop early once new items dry up' +
    '</label>' +
    '<div class="sh-drawer__catchupresult"></div>' +
    '<button type="button" class="sh-drawer__auditbtn">Full audit (chunked)</button>' +
    '<div class="sh-drawer__auditresult"></div>' +
    '<button type="button" class="sh-drawer__reconbtn">Reconcile Favorites (from AO3 bookmarks)</button>' +
    '<label class="sh-drawer__reconopt">Pages per chunk' +
    '<input type="number" class="sh-drawer__reconchunk" min="1" max="100" value="10" title="How many bookmark pages to scan per click. Lower this if AO3 rate-limits you — the scan resumes where it stopped, so you can wait out the limit and Continue.">' +
    '</label>' +
    '<div class="sh-drawer__reconresult"></div>' +
    '</div>' +
    '<div class="sh-drawer__status"></div>' +
    '<ul class="sh-drawer__list"></ul>' +
    '<div class="sh-drawer__fetch">' +
    '<button type="button" class="sh-drawer__fetchbtn">Fetch queued stories</button>' +
    '<div class="sh-drawer__fetchresult"></div>' +
    '</div>' +
    '<div class="sh-drawer__foot">' +
    '<input type="number" class="sh-drawer__batch" min="1" max="50" value="5" title="How many to apply to AO3 per click (keeps you under AO3 rate limits)">' +
    '<button type="button" class="sh-drawer__apply"></button>' +
    '<button type="button" class="sh-drawer__refresh" title="Refresh">↻</button>' +
    '</div>'

  const listEl = panel.querySelector('.sh-drawer__list')
  const statusEl = panel.querySelector('.sh-drawer__status')
  const applyBtn = panel.querySelector('.sh-drawer__apply')
  const batchInput = panel.querySelector('.sh-drawer__batch')
  const fetchBtn = panel.querySelector('.sh-drawer__fetchbtn')
  const fetchResult = panel.querySelector('.sh-drawer__fetchresult')
  const catchupBtn = panel.querySelector('.sh-drawer__catchupbtn')
  const catchupStopChk = panel.querySelector('.sh-drawer__catchupstop')
  const catchupResult = panel.querySelector('.sh-drawer__catchupresult')
  const auditBtn = panel.querySelector('.sh-drawer__auditbtn')
  const auditResult = panel.querySelector('.sh-drawer__auditresult')
  const reconBtn = panel.querySelector('.sh-drawer__reconbtn')
  const reconChunkInput = panel.querySelector('.sh-drawer__reconchunk')
  const reconResult = panel.querySelector('.sh-drawer__reconresult')
  let catchupNewIds = [] // populated by the preview; MfL-2 captures these
  let auditCaptureIds = [] // audit: MfL not in library (capture candidates)
  let auditRemoveIds = [] // audit: read/DNF but still on AO3 to-read (clear candidates)
  let reconFavoriteIds = [] // recon: in-library bookmark ids to favorite (server idempotent)
  let reconCaptureIds = [] // recon: bookmarked but not in library (capture candidates)
  let reconBookmarkIds = [] // recon: favorited here but NOT bookmarked on AO3 (reverse gap)
  const STOP_TOLERANCE = 3 // consecutive pages with no new items before early-stop
  const AUDIT_KEY = 'sh_mfl_audit' // chrome.storage.local: resumable full-scan state
  const RECON_KEY = 'sh_bm_recon' // chrome.storage.local: resumable bookmark-scan state
  const CHUNK_PAGES = 50 // pages per audit chunk (pause between to stay under AO3 limits)

  function mount() {
    if (!document.body) return
    document.body.appendChild(tab)
    document.body.appendChild(panel)
    tab.addEventListener('click', toggle)
    panel.querySelector('.sh-drawer__close').addEventListener('click', () => setOpen(false))
    panel.querySelector('.sh-drawer__refresh').addEventListener('click', load)
    applyBtn.addEventListener('click', applyAo3)
    batchInput.addEventListener('input', render) // keep the "(n/total)" label in sync
    fetchBtn.addEventListener('click', runFetchQueue)
    catchupBtn.addEventListener('click', runCatchup)
    auditBtn.addEventListener('click', runAudit)
    reconBtn.addEventListener('click', runRecon)
    initAudit()
    initRecon()
  }

  /* --- Full audit (chunked, resumable) ----------------------------------------
     A complete MfL scan in CHUNK_PAGES-page chunks (the to-read list is ordered by
     last-VIEWED, so new items are scattered and a partial scan misses them). State
     persists in chrome.storage.local so you can pause between chunks (AO3 throttles
     long runs) and resume — even after navigating. When the last page is reached it
     renders the bidirectional report. */
  function getAudit() {
    return new Promise((resolve) =>
      chrome.storage.local.get(AUDIT_KEY, (o) =>
        resolve(o[AUDIT_KEY] || { ids: [], lastPage: 0, complete: false })))
  }
  function setAudit(s) {
    return new Promise((resolve) => chrome.storage.local.set({ [AUDIT_KEY]: s }, resolve))
  }
  async function refreshAuditButton() {
    const s = await getAudit()
    if (s.complete) auditBtn.textContent = 'Re-run full audit'
    else if (s.lastPage > 0) auditBtn.textContent = `Continue audit (from page ${s.lastPage + 1})`
    else auditBtn.textContent = 'Full audit (chunked)'
  }
  async function initAudit() {
    await refreshAuditButton()
    const s = await getAudit()
    if (s.complete) renderAuditReport(s) // re-show last audit only if action items remain
  }

  async function runAudit() {
    if (busy) return
    busy = true
    auditBtn.disabled = true
    render()
    try {
      let state = await getAudit()
      if (state.complete) {
        state = { ids: [], lastPage: 0, complete: false } // "Re-run" → start fresh
        await setAudit(state)
      }
      auditResult.textContent = `Scanning pages ${state.lastPage + 1}–${state.lastPage + CHUNK_PAGES}…`
      const r = await SH.ao3.fetchMarkedForLaterIds({
        startPage: state.lastPage + 1,
        pageLimit: CHUNK_PAGES,
        stopAfterDupePages: 0, // full scan — no early stop
        onProgress: (m) => { auditResult.textContent = 'Scanning… ' + m },
      })
      const merged = new Set(state.ids)
      for (const id of r.allIds) merged.add(id)
      state = {
        ids: [...merged],
        lastPage: r.lastPage,
        complete: !r.hasMore && !r.incomplete,
        updatedAt: Date.now(),
      }
      await setAudit(state)
      if (r.incomplete) {
        auditResult.innerHTML =
          `<div class="sh-catchup__warn">⚠ AO3 throttled at ${r.incompleteReason}. ` +
          `Collected ${state.ids.length} so far (through page ${state.lastPage}). ` +
          `Wait a couple minutes, then Continue.</div>`
      } else if (!state.complete) {
        auditResult.innerHTML =
          `<div class="sh-catchup__line">Scanned through page ${state.lastPage} · ` +
          `${state.ids.length} marked-for-later collected.</div>` +
          `<div class="sh-catchup__note">Paused for AO3 — click “Continue audit” for the next ${CHUNK_PAGES} pages.</div>`
      } else {
        renderAuditReport(state, { justRan: true })
      }
    } catch (e) {
      auditResult.textContent = 'Audit failed: ' + e.message
      log('audit failed:', e.message)
    } finally {
      busy = false
      auditBtn.disabled = false
      await refreshAuditButton()
      render()
    }
  }

  async function renderAuditReport(state, opts = {}) {
    const mflSet = new Set(state.ids)
    const badgeMap = await SH.storage.getBadgeMap()
    const captureNew = []
    const readStillMarked = []
    let unreadConsistent = 0
    for (const id of state.ids) {
      const e = badgeMap[id]
      if (!e) { captureNew.push(id); continue }
      if (e.s === 'Read' || e.s === 'DNF') readStillMarked.push(id)
      else unreadConsistent += 1
    }
    let unreadNotMarked = 0
    for (const k in badgeMap) {
      if (badgeMap[k].s === 'Unread' && !mflSet.has(Number(k))) unreadNotMarked += 1
    }
    auditCaptureIds = captureNew
    auditRemoveIds = readStillMarked
    // The panel is gated on outstanding action items (capture + clear). With none,
    // it stays hidden on reopen; a just-run audit gets a transient "in sync" note so
    // the run still confirms it completed.
    if (!captureNew.length && !readStillMarked.length) {
      auditResult.innerHTML = opts.justRan
        ? `<div class="sh-catchup__summary">Audit complete — ${state.ids.length} marked for later, nothing to capture or clear (in sync).</div>`
        : ''
      return
    }
    auditResult.innerHTML =
      `<div class="sh-catchup__summary">Audit complete — ${state.ids.length} marked for later</div>` +
      `<div class="sh-audit__row"><b>${captureNew.length}</b> not in library → can capture</div>` +
      `<div class="sh-audit__row"><b>${readStillMarked.length}</b> read/DNF but still on AO3 to-read → can clear from AO3</div>` +
      `<div class="sh-audit__row">${unreadConsistent} unread &amp; on to-read (in sync)</div>` +
      `<div class="sh-audit__row"><b>${unreadNotMarked}</b> unread in library, NOT on AO3 to-read (review only)</div>` +
      (captureNew.length ? `<button type="button" class="sh-action-btn" data-act="capture">Capture ${captureNew.length} new →</button>` : '') +
      (readStillMarked.length ? `<button type="button" class="sh-action-btn sh-action-btn--quiet" data-act="clear">Clear ${readStillMarked.length} from AO3 to-read</button>` : '') +
      `<button type="button" class="sh-action-btn sh-action-btn--quiet" data-act="dismiss" title="Discard this audit snapshot — no AO3 requests">Dismiss</button>`
    const cap = auditResult.querySelector('[data-act="capture"]')
    if (cap) cap.addEventListener('click', () => runCapture(auditCaptureIds, auditResult))
    const clr = auditResult.querySelector('[data-act="clear"]')
    if (clr) clr.addEventListener('click', () => runClearRead(auditRemoveIds, auditResult))
    const dis = auditResult.querySelector('[data-act="dismiss"]')
    if (dis) dis.addEventListener('click', dismissAudit)
  }

  /* Discard the stored audit snapshot without touching AO3. The snapshot is a
     point-in-time scrape; once the normal queue has cleared its read/DNF entries
     off AO3 to-read, the leftovers here are stale false positives. Dismiss wipes
     them locally (zero AO3 requests) and hides the panel until the next audit. */
  async function dismissAudit() {
    if (busy) return
    await setAudit({ ids: [], lastPage: 0, complete: false })
    auditCaptureIds = []
    auditRemoveIds = []
    auditResult.innerHTML = ''
    await refreshAuditButton()
  }

  /* --- Reconcile Favorites (from AO3 bookmarks) -------------------------------
     One-time-ish fix for the migration gap: is_favorite was seeded from Calibre
     alone, so the real AO3 bookmark set was never reconciled. Scrape every bookmarked
     work id (chunked + resumable like the audit — AO3 throttles long scans), bucket
     against the library (badge cache), and report:
       - bookmarked + in library + not favorited -> favorite (any bookmark = Favorite)
       - bookmarked + not in library            -> capture candidates
       - favorited here + NOT bookmarked on AO3 -> reverse gap (create AO3 bookmarks)
     Applying favorites is a single server call (reconcileFavorites) that also forces
     Read and rebuilds the snapshot. */
  function getRecon() {
    return new Promise((resolve) =>
      chrome.storage.local.get(RECON_KEY, (o) =>
        resolve(o[RECON_KEY] || { ids: [], lastPage: 0, complete: false })))
  }
  function setRecon(s) {
    return new Promise((resolve) => chrome.storage.local.set({ [RECON_KEY]: s }, resolve))
  }
  function reconChunkSize() {
    const v = parseInt(reconChunkInput.value, 10)
    return Number.isFinite(v) && v > 0 ? Math.min(v, 100) : 10
  }
  async function refreshReconButton() {
    const s = await getRecon()
    if (s.complete) reconBtn.textContent = 'Re-run Reconcile Favorites'
    else if (s.lastPage > 0) reconBtn.textContent = `Continue reconcile (from page ${s.lastPage + 1})`
    else reconBtn.textContent = 'Reconcile Favorites (from AO3 bookmarks)'
  }
  async function initRecon() {
    await refreshReconButton()
    const s = await getRecon()
    if (s.complete) renderReconReport(s)
  }

  async function runRecon() {
    if (busy) return
    busy = true
    reconBtn.disabled = true
    render()
    try {
      let state = await getRecon()
      if (state.complete) {
        state = { ids: [], lastPage: 0, complete: false } // "Re-run" → start fresh
        await setRecon(state)
      }
      const chunk = reconChunkSize()
      reconResult.textContent = `Scanning bookmark pages ${state.lastPage + 1}–${state.lastPage + chunk}…`
      const r = await SH.ao3.fetchBookmarkedIds({
        startPage: state.lastPage + 1,
        pageLimit: chunk,
        onProgress: (m) => { reconResult.textContent = 'Scanning… ' + m },
      })
      const merged = new Set(state.ids)
      for (const id of r.allIds) merged.add(id)
      state = {
        ids: [...merged],
        lastPage: r.lastPage,
        complete: !r.hasMore && !r.incomplete,
        updatedAt: Date.now(),
      }
      await setRecon(state)
      if (r.incomplete) {
        reconResult.innerHTML =
          `<div class="sh-catchup__warn">⚠ AO3 throttled at ${r.incompleteReason}. ` +
          `Collected ${state.ids.length} so far (through page ${state.lastPage}). ` +
          `Wait a couple minutes, then Continue.</div>`
      } else if (!state.complete) {
        reconResult.innerHTML =
          `<div class="sh-catchup__line">Scanned through page ${state.lastPage} · ` +
          `${state.ids.length} bookmarks collected.</div>` +
          `<div class="sh-catchup__note">Paused for AO3 — wait out any rate-limit, then click “Continue reconcile” for the next ${chunk} pages.</div>`
      } else {
        renderReconReport(state, { justRan: true })
      }
    } catch (e) {
      reconResult.textContent = 'Reconcile scan failed: ' + e.message
      log('recon failed:', e.message)
    } finally {
      busy = false
      reconBtn.disabled = false
      await refreshReconButton()
      render()
    }
  }

  async function renderReconReport(state, opts = {}) {
    const bmSet = new Set(state.ids)
    const badgeMap = await SH.storage.getBadgeMap()
    const toFavorite = [] // bookmarked, in library, not favorited
    const captureNew = [] // bookmarked, not in library
    let alreadyFav = 0 // bookmarked, in library, already favorite
    for (const id of state.ids) {
      const e = badgeMap[id]
      if (!e) { captureNew.push(id); continue }
      if (e.f) alreadyFav += 1
      else toFavorite.push(id)
    }
    // Reverse gap: favorited in the library but absent from the AO3 bookmark set.
    // Real, non-deleted AO3 works only (pre-AO3 favorites have negative ids and no
    // AO3 work to bookmark; deleted works can't be bookmarked).
    const reverseGap = []
    for (const k in badgeMap) {
      const id = Number(k)
      const e = badgeMap[k]
      if (id > 0 && e.f && e.a !== 'deleted' && !bmSet.has(id)) reverseGap.push(id)
    }
    reconFavoriteIds = state.ids.filter((id) => badgeMap[id]) // all in-library bookmarks
    reconCaptureIds = captureNew
    reconBookmarkIds = reverseGap

    if (!toFavorite.length && !captureNew.length && !reverseGap.length) {
      reconResult.innerHTML = opts.justRan
        ? `<div class="sh-catchup__summary">Reconcile complete — ${state.ids.length} AO3 bookmarks, all already favorited (in sync).</div>`
        : ''
      return
    }
    reconResult.innerHTML =
      `<div class="sh-catchup__summary">Reconcile complete — ${state.ids.length} AO3 bookmarks</div>` +
      `<div class="sh-audit__row"><b>${toFavorite.length}</b> bookmarked, in library, not yet favorited → can favorite</div>` +
      `<div class="sh-audit__row">${alreadyFav} already favorited (in sync)</div>` +
      `<div class="sh-audit__row"><b>${captureNew.length}</b> bookmarked but not in library → can capture</div>` +
      `<div class="sh-audit__row"><b>${reverseGap.length}</b> favorited here but NOT bookmarked on AO3 → can create bookmarks</div>` +
      (toFavorite.length ? `<button type="button" class="sh-action-btn" data-act="favorite">Favorite ${toFavorite.length} →</button>` : '') +
      (captureNew.length ? `<button type="button" class="sh-action-btn sh-action-btn--quiet" data-act="capture">Capture ${captureNew.length} new →</button>` : '') +
      (reverseGap.length ? `<button type="button" class="sh-action-btn sh-action-btn--quiet" data-act="bookmark">Create ${reverseGap.length} AO3 bookmark(s)</button>` : '') +
      `<button type="button" class="sh-action-btn sh-action-btn--quiet" data-act="dismiss" title="Discard this scan — no AO3 requests">Dismiss</button>`
    const fav = reconResult.querySelector('[data-act="favorite"]')
    if (fav) fav.addEventListener('click', () => runFavorite(reconFavoriteIds, toFavorite.length, reconResult))
    const cap = reconResult.querySelector('[data-act="capture"]')
    if (cap) cap.addEventListener('click', () => runCapture(reconCaptureIds, reconResult))
    const bm = reconResult.querySelector('[data-act="bookmark"]')
    if (bm) bm.addEventListener('click', () => runCreateBookmarks(reconBookmarkIds, reconResult))
    const dis = reconResult.querySelector('[data-act="dismiss"]')
    if (dis) dis.addEventListener('click', dismissRecon)
  }

  /* Apply the favorite backfill: one server call sets is_favorite + forces Read for
     every supplied in-library bookmark (idempotent), then rebuilds the snapshot. The
     badge cache refreshes on the SW's next snapshot sync. */
  async function runFavorite(ids, newCount, statusEl) {
    if (busy || !ids.length) return
    if (!window.confirm(
      `Mark ${newCount} bookmarked work(s) as Favorite (and Read) in StoryHub?\n\n` +
      `This only writes to StoryHub — your AO3 bookmarks are unchanged.`
    )) return
    busy = true
    reconBtn.disabled = true
    render()
    try {
      statusEl.innerHTML = `<div class="sh-catchup__line">Applying favorites…</div>`
      const r = await SH.api.reconcileFavorites(ids)
      const notIn = (r.not_in_library || []).length
      statusEl.innerHTML =
        `<div class="sh-catchup__summary">Favorited ${r.favorited} · ${r.already} already · ${r.newly_read} marked Read</div>` +
        (notIn ? `<div class="sh-catchup__note">${notIn} not in library — capture them, then reconcile again.</div>` : '') +
        `<div class="sh-catchup__note">Snapshot rebuilt — reopen the PWA to see the updated Favorites.</div>`
    } catch (e) {
      statusEl.innerHTML = `<div class="sh-catchup__warn">Favorite failed: ${escapeHtml(e.message)}</div>`
    } finally {
      busy = false
      reconBtn.disabled = false
      render()
    }
  }

  /* Create the missing private AO3 bookmarks (reverse gap): works favorited in the
     library but not bookmarked on AO3 — Calibre-era favorites plus any stranded by the
     earlier bookmark bug. createBookmark is idempotent (skips ones already bookmarked),
     so this is resume-safe; it stops on an AO3 rate-limit so you can continue later. */
  async function runCreateBookmarks(ids, statusEl) {
    if (busy || !ids.length) return
    if (!window.confirm(
      `Create ${ids.length} private AO3 bookmark(s) for works favorited in StoryHub but not bookmarked on AO3?\n\n` +
      `Each is a separate AO3 request, so this can take a while. If AO3 throttles or you stop, run it again — ` +
      `it resumes (skips works already bookmarked).`
    )) return
    busy = true
    reconBtn.disabled = true
    render()
    try {
      let done = 0; let failed = 0; let rateLimited = false
      const fails = []
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        statusEl.innerHTML = `<div class="sh-catchup__line">Bookmarking ${i + 1}/${ids.length} — work ${id}…</div>`
        try {
          const ok = await SH.ao3.createBookmark(id) // true if created OR already bookmarked
          ok ? done++ : (failed++, fails.length < 15 && fails.push(`${id}: create returned not-ok`))
        } catch (e) {
          if (e.message === 'RATE_LIMIT') { rateLimited = true; break }
          failed++; if (fails.length < 15) fails.push(`${id}: ${e.message}`)
        }
        await new Promise((res) => setTimeout(res, 1500 + Math.floor(Math.random() * 800)))
      }
      statusEl.innerHTML =
        (rateLimited
          ? `<div class="sh-catchup__summary">AO3 rate-limited — created ${done}. Wait a minute, then run it again for the rest.</div>`
          : `<div class="sh-catchup__summary">Created ${done} AO3 bookmark(s) · ${failed} failed</div>`) +
        (fails.length ? `<div class="sh-catchup__warn">${fails.map(escapeHtml).join('<br>')}</div>` : '')
    } finally {
      busy = false
      reconBtn.disabled = false
      render()
    }
  }

  /* Discard the stored bookmark scan without touching AO3 (mirrors dismissAudit). */
  async function dismissRecon() {
    if (busy) return
    await setRecon({ ids: [], lastPage: 0, complete: false })
    reconFavoriteIds = []
    reconCaptureIds = []
    reconBookmarkIds = []
    reconResult.innerHTML = ''
    await refreshReconButton()
  }

  /* Bulk-capture a set of work ids into the pending queue (the audit's "not in
     library" set, or the catch-up preview's new set). Resume-safe: re-dedupes against
     library + queue each run, so re-running after a stop just continues. Throttled +
     429-resilient (lib/capture.js). */
  async function runCapture(ids, statusEl) {
    if (busy || !ids.length) return
    if (!window.confirm(
      `Capture ${ids.length} work(s) into the queue?\n\nEach is fetched + its epub downloaded from AO3, so this can take several minutes. ` +
      `If AO3 throttles or you stop, just run it again — it resumes (skips what's already captured).`
    )) return
    busy = true
    auditBtn.disabled = true
    catchupBtn.disabled = true
    reconBtn.disabled = true
    render()
    try {
      const badgeMap = await SH.storage.getBadgeMap()
      const pending = new Set()
      try {
        for (const p of await SH.api.listPending()) if (p.action === 'capture') pending.add(Number(p.work_id))
      } catch (e) { log('listPending failed before capture:', e.message) }
      const todo = ids.filter((id) => !badgeMap[id] && !pending.has(id))
      let done = 0; let skipped = 0; let failed = 0
      const fails = []
      for (let i = 0; i < todo.length; i++) {
        const id = todo[i]
        statusEl.innerHTML = `<div class="sh-catchup__line">Capturing ${i + 1}/${todo.length} — work ${id}…</div>`
        let r
        try { r = await SH.capture.captureWorkById(id) } catch (e) { r = { ok: false, reason: e.message } }
        if (r.ok) done += 1
        else if (r.skipped) skipped += 1
        else { failed += 1; if (fails.length < 15) fails.push(`${id}: ${r.reason}`) }
        await new Promise((res) => setTimeout(res, 1500 + Math.floor(Math.random() * 800)))
      }
      statusEl.innerHTML =
        `<div class="sh-catchup__summary">Captured ${done} · ${skipped} WIP skipped · ${failed} failed</div>` +
        (fails.length ? `<div class="sh-catchup__warn">${fails.map(escapeHtml).join('<br>')}</div>` : '') +
        `<div class="sh-catchup__note">Open the PWA: confirm any primaries in the Review Queue, then Apply to Library.</div>`
      load() // refresh the queue list with the new pending items
    } catch (e) {
      statusEl.textContent = 'Capture failed: ' + e.message
    } finally {
      busy = false
      auditBtn.disabled = false
      catchupBtn.disabled = false
      reconBtn.disabled = false
      render()
    }
  }

  /* Clear already-read works off the AO3 Marked-for-Later list (the audit's "read but
     still on to-read" set). markAsRead removes an on-MfL work from to-read. */
  async function runClearRead(ids, statusEl) {
    if (busy || !ids.length) return
    if (!window.confirm(`Remove ${ids.length} already-read work(s) from your AO3 Marked for Later?`)) return
    busy = true
    auditBtn.disabled = true
    render()
    try {
      let done = 0; let failed = 0; let deleted = 0; let rateLimited = false
      const fails = []
      const cleared = [] // ids to drop from the cached scan (2xx cleared, or 404 = gone from AO3)
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        statusEl.innerHTML = `<div class="sh-catchup__line">Clearing ${i + 1}/${ids.length} — work ${id}…</div>`
        try {
          const r = await SH.ao3.markAsReadResult(id)
          if (r.ok) { done += 1; cleared.push(id) }
          // 404 = the work was deleted on AO3, so it's already off Marked-for-Later;
          // nothing to clear. Drop it from the list instead of failing forever.
          else if (r.status === 404) { deleted += 1; cleared.push(id) }
          else { failed += 1; if (fails.length < 15) fails.push(`${id}: HTTP ${r.status}`) }
        } catch (e) {
          if (e.message === 'RATE_LIMIT') { rateLimited = true; break }
          failed += 1; if (fails.length < 15) fails.push(`${id}: ${e.message}`)
        }
        await new Promise((res) => setTimeout(res, 1200 + Math.floor(Math.random() * 600)))
      }
      // mark_as_read removed these from AO3's to-read list, but the persisted MfL
      // scan (AUDIT_KEY) still lists them — so without trimming it the report keeps
      // showing the same works on refresh/retry ("starts over"). Drop the confirmed
      // ones so a rate-limited run is non-destructive: the next Clear only does the
      // remainder, and a refresh shows the reduced set.
      const delNote = deleted ? ` · ${deleted} deleted on AO3 (dropped)` : ''
      const summary =
        (rateLimited
          ? `<div class="sh-catchup__summary">AO3 rate-limited — cleared ${done}${delNote}. Wait a minute, then run Clear again for the rest.</div>`
          : `<div class="sh-catchup__summary">Cleared ${done} from AO3 to-read${delNote} · ${failed} failed</div>`) +
        (fails.length ? `<div class="sh-catchup__warn">${fails.map(escapeHtml).join('<br>')}</div>` : '')
      if (cleared.length) {
        const gone = new Set(cleared)
        const st = await getAudit()
        st.ids = (st.ids || []).filter((x) => !gone.has(x))
        await setAudit(st)
        auditRemoveIds = auditRemoveIds.filter((x) => !gone.has(x))
        await renderAuditReport(st) // rebuilds the report + Clear button from the trimmed set
        auditResult.insertAdjacentHTML('beforeend', summary)
      } else {
        statusEl.innerHTML = summary
      }
    } finally {
      busy = false
      auditBtn.disabled = false
      render()
    }
  }

  /* Fetch captures awaiting an epub: stories queued from the PWA (paste-a-URL /
     share target) plus any capture whose epub fetch previously failed — the server's
     fetch-queue returns both (staging_key IS NULL). Only this page context can fetch
     AO3 + the epub. Each captureWorkById supersedes the row with the completed
     capture. Resume-safe: a filled capture gets a staging_key and drops out of
     fetch-queue, so re-running after a throttle/stop/failure just continues. */
  async function runFetchQueue() {
    if (busy) return
    let stubs
    fetchResult.textContent = 'Checking…'
    try {
      stubs = await SH.api.fetchQueue()
    } catch (e) {
      fetchResult.textContent = 'Couldn’t load the fetch queue: ' + e.message
      return
    }
    if (!stubs.length) { fetchResult.textContent = 'Nothing to fetch.'; return }
    if (!window.confirm(
      `Fetch ${stubs.length} queued story(ies)?\n\nEach is fetched + its epub downloaded from AO3, so this can take several minutes. ` +
      `If AO3 throttles or you stop, just run it again — it resumes (skips what’s already fetched).`
    )) { fetchResult.textContent = ''; return }
    busy = true
    fetchBtn.disabled = true
    catchupBtn.disabled = true
    auditBtn.disabled = true
    render()
    try {
      const badgeMap = await SH.storage.getBadgeMap()
      // The stubs themselves are pending captures, so we DON'T dedupe against the
      // pending queue (that's the whole list) — only skip anything already in library.
      const ids = stubs.map((s) => Number(s.work_id)).filter((id) => !badgeMap[id])
      let done = 0; let skipped = 0; let failed = 0
      const fails = []
      for (let i = 0; i < ids.length; i++) {
        const id = ids[i]
        fetchResult.innerHTML = `<div class="sh-catchup__line">Fetching ${i + 1}/${ids.length} — work ${id}…</div>`
        let r
        try { r = await SH.capture.captureWorkById(id) } catch (e) { r = { ok: false, reason: e.message } }
        if (r.ok) done += 1
        else if (r.skipped) skipped += 1
        else { failed += 1; if (fails.length < 15) fails.push(`${id}: ${r.reason}`) }
        await new Promise((res) => setTimeout(res, 1500 + Math.floor(Math.random() * 800)))
      }
      fetchResult.innerHTML =
        `<div class="sh-catchup__summary">Fetched ${done} · ${skipped} WIP skipped · ${failed} failed</div>` +
        (fails.length ? `<div class="sh-catchup__warn">${fails.map(escapeHtml).join('<br>')}</div>` : '') +
        `<div class="sh-catchup__note">Open the PWA: confirm any primaries in the Review Queue, then Apply to Library.</div>`
      load() // refresh the queue list (stubs replaced by real captures)
    } catch (e) {
      fetchResult.textContent = 'Fetch failed: ' + e.message
    } finally {
      busy = false
      fetchBtn.disabled = false
      catchupBtn.disabled = false
      auditBtn.disabled = false
      render()
    }
  }

  /* Catch up from Marked for Later (MfL-1: enumerate + preview). Scrapes the AO3
     readings list for marked-for-later work ids, then buckets them against the
     library (badge cache) and the pending queue. The actual bulk capture of the
     "new" set lands in MfL-2. */
  async function runCatchup() {
    if (busy) return
    busy = true
    catchupBtn.disabled = true
    render()
    catchupResult.textContent = 'Preparing…'
    try {
      // Compute the dupe predicate up front (cheap, local) so enumeration can dedupe
      // during the scan and early-stop on the already-imported tail.
      const badgeMap = await SH.storage.getBadgeMap()
      const pendingCaptures = new Set()
      try {
        for (const p of await SH.api.listPending()) {
          if (p.action === 'capture') pendingCaptures.add(Number(p.work_id))
        }
      } catch (e) {
        log('listPending failed during catch-up (preview only):', e.message)
      }
      const isDupe = (id) => !!badgeMap[id] || pendingCaptures.has(id)

      const r = await SH.ao3.fetchMarkedForLaterIds({
        isDupe,
        stopAfterDupePages: catchupStopChk.checked ? STOP_TOLERANCE : 0,
        onProgress: (m) => { catchupResult.textContent = 'Scanning… ' + m },
      })
      catchupNewIds = r.newIds

      const head = r.stoppedEarly
        ? `<div class="sh-catchup__summary"><b>${r.newIds.length}</b> new to capture</div>` +
          `<div class="sh-catchup__line">stopped after ${STOP_TOLERANCE} pages with no new items · ` +
          `scanned ${r.pagesScanned}, ${r.dupeTotal} already imported</div>`
        : `<div class="sh-catchup__summary">Marked for Later: <b>${r.mflTotal}</b>${r.incomplete ? '+' : ''}</div>` +
          `<div class="sh-catchup__line"><b>${r.newIds.length}</b> new · ${r.dupeTotal} already in library/queue</div>`
      const note = r.incomplete
        ? `<div class="sh-catchup__warn">⚠ Scan didn’t finish (${r.incompleteReason}) — partial results. AO3 rate-limits long scans; retry shortly. For completeness use the full audit.</div>`
        : r.newIds.length
          ? `<div class="sh-catchup__note">Nothing added yet — click Capture to queue these.</div>`
          : `<div class="sh-catchup__note">Nothing new to capture.</div>`
      const capBtn = r.newIds.length
        ? `<button type="button" class="sh-action-btn" data-act="capture">Capture ${r.newIds.length} new →</button>`
        : ''
      catchupResult.innerHTML = head + note + capBtn
      const cb = catchupResult.querySelector('[data-act="capture"]')
      if (cb) cb.addEventListener('click', () => runCapture(catchupNewIds, catchupResult))
    } catch (e) {
      catchupResult.textContent = 'Catch-up failed: ' + e.message
      log('catch-up failed:', e.message)
    } finally {
      busy = false
      catchupBtn.disabled = false
      render()
    }
  }

  function setOpen(v) {
    open = v
    panel.classList.toggle('is-open', open)
    if (open) load()
  }
  function toggle() { setOpen(!open) }

  // A capture still awaiting its PC epub fetch (URL/share stub or failed-epub retry).
  // Its AO3 side must NOT be applied yet: the fetch supersedes the row and resets the
  // AO3 state, so applying first is wasted (and confusing). Mirrors the server's
  // fetch-queue predicate (staging_key IS NULL).
  function needsFetch(it) {
    return it.action === 'capture' && it.library_state === 'pending' && !it.staging_key
  }
  function ao3Pending() { return items.filter((i) => i.ao3_state === 'pending' && !needsFetch(i)) }

  function batchSize() {
    const v = parseInt(batchInput.value, 10)
    return Number.isFinite(v) && v > 0 ? Math.min(v, 50) : 5
  }

  function render() {
    const n = ao3Pending().length
    tab.textContent = `Queue${items.length ? ` (${items.length})` : ''}`
    tab.classList.toggle('has-items', items.length > 0)
    // Apply in batches (AO3 rate-limits a rapid burst) — show this-batch/total.
    applyBtn.textContent = n ? `Apply to AO3 (${Math.min(batchSize(), n)}/${n})` : 'Apply to AO3'
    applyBtn.disabled = busy || n === 0

    // Captures still awaiting a PC epub fetch: app stubs + any whose epub failed.
    const fetchN = items.filter(needsFetch).length
    fetchBtn.textContent = `Fetch queued stories${fetchN ? ` (${fetchN})` : ''}`
    fetchBtn.disabled = busy

    listEl.innerHTML = ''
    if (!items.length) {
      const li = document.createElement('li')
      li.className = 'sh-drawer__empty'
      li.textContent = 'Queue is clear.'
      listEl.appendChild(li)
      return
    }
    for (const it of items) {
      const li = document.createElement('li')
      li.className = 'sh-drawer__item'
      const sides =
        `<span class="sh-side sh-side--${it.ao3_state}">AO3: ${it.ao3_state}</span>` +
        `<span class="sh-side sh-side--${it.library_state}">Lib: ${it.library_state}</span>`
      li.innerHTML =
        `<div class="sh-drawer__itemmain">` +
        `<div class="sh-drawer__itemtop"><span class="sh-drawer__act">${QUEUE_LABEL[it.action] || it.action}</span>` +
        `<span class="sh-drawer__work">${escapeHtml(it.title || ('work ' + it.work_id))}</span></div>` +
        `<div class="sh-drawer__sides">${sides}${it.author ? `<span class="sh-drawer__by">${escapeHtml(it.author)}</span>` : ''}</div>` +
        (it.error ? `<div class="sh-drawer__err">${escapeHtml(it.error)}</div>` : '') +
        `</div>` +
        `<button type="button" class="sh-drawer__cancel" data-id="${it.id}">Cancel</button>`
      li.querySelector('.sh-drawer__cancel').addEventListener('click', () => cancel(it.id))
      listEl.appendChild(li)
    }
  }

  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  }

  function setStatus(msg) { statusEl.textContent = msg || '' }

  async function load() {
    if (!(await SH.storage.isConfigured())) return
    try {
      items = await SH.api.listPending()
    } catch (e) {
      items = []
      setStatus('Load failed: ' + e.message)
      render()
      return
    }
    setStatus('')
    render()
  }

  async function cancel(id) {
    try {
      await SH.api.cancelPending(id)
      items = items.filter((i) => i.id !== id)
      render()
    } catch (e) {
      setStatus('Cancel failed: ' + e.message)
    }
  }

  // Apply the AO3 side-effects in a throttled BATCH (the batch-size box). AO3
  // rate-limits a rapid burst, so we do at most batchSize() per click, ~1.5s apart,
  // and STOP immediately if AO3 starts throttling (RATE_LIMIT) — the rest stay queued
  // for the next click. This lets you break a big queue into safe chunks.
  async function applyAo3() {
    if (busy) return
    busy = true
    render()
    const todo = ao3Pending().slice(0, batchSize())
    let done = 0
    let failed = 0
    let rateLimited = false
    const toReadDrop = [] // applied actions that removed a work from AO3 to-read
    const toReadAdd = []  // applied actions that put a work back on AO3 to-read
    for (let i = 0; i < todo.length; i++) {
      const it = todo[i]
      setStatus(`Applying ${i + 1}/${todo.length}…`)
      let ok = false
      let err = null
      try {
        ok = await AO3_APPLY[it.action](it.work_id)
      } catch (e) {
        err = e.message
        if (e.message === 'RATE_LIMIT') rateLimited = true
      }
      try {
        await SH.api.ackAo3(it.id, ok ? 'done' : 'pending', ok ? undefined : (err || 'apply failed'))
      } catch (e) {
        log('ack failed', it.id, e.message)
      }
      if (ok) {
        const eff = AO3_TOREAD_EFFECT[it.action]
        if (eff === 'remove') toReadDrop.push(Number(it.work_id))
        else if (eff === 'add') toReadAdd.push(Number(it.work_id))
      }
      ok ? done++ : failed++
      if (rateLimited) break
      if (i < todo.length - 1) await new Promise((r) => setTimeout(r, 1500 + Math.floor(Math.random() * 800)))
    }
    // Keep the audit snapshot in step with what this queue just did to AO3 to-read,
    // so a re-shown audit doesn't list works already cleared here. Only while a
    // completed audit exists; re-render hides the panel if no action items remain.
    if (toReadDrop.length || toReadAdd.length) {
      const st = await getAudit()
      if (st.complete) {
        const ids = new Set(st.ids)
        for (const w of toReadDrop) ids.delete(w)
        for (const w of toReadAdd) ids.add(w)
        st.ids = [...ids]
        await setAudit(st)
        await renderAuditReport(st)
      }
    }
    busy = false
    await load() // refresh the remaining count
    const remaining = ao3Pending().length
    if (rateLimited) {
      setStatus(`AO3 rate-limited — applied ${done}. Wait a minute, then apply the next batch${remaining ? ` (${remaining} left)` : ''}.`)
    } else {
      setStatus(`Applied ${done} to AO3${failed ? `, ${failed} failed` : ''}${remaining ? ` · ${remaining} left` : ''}`)
    }
  }

  SH.drawer = { refresh: load, open: () => setOpen(true) }

  mount()
  load() // seed the count badge
})()
