/* Railway hub client. Single bearer token, set once in the options page
   (docs/auth.md). Every call reads the stored config unless creds are passed
   explicitly (validate(), during first-run setup, has no stored config yet). */
(function () {
  const SH = (globalThis.SH = globalThis.SH || {})

  function normHub(url) {
    return (url || '').trim().replace(/\/+$/, '')
  }

  async function creds() {
    const cfg = await SH.storage.getConfig()
    if (!cfg || !cfg.hubUrl || !cfg.token) throw new Error('NOT_CONFIGURED')
    return { hubUrl: normHub(cfg.hubUrl), token: cfg.token }
  }

  async function req(path, { method = 'GET', body, rawBody, contentType, raw = false, auth } = {}) {
    const { hubUrl, token } = auth || (await creds())
    const headers = { Authorization: `Bearer ${token}` }
    let payload
    if (rawBody !== undefined) {
      if (contentType) headers['Content-Type'] = contentType
      payload = rawBody
    } else if (body !== undefined) {
      headers['Content-Type'] = 'application/json'
      payload = JSON.stringify(body)
    }
    const res = await fetch(`${hubUrl}${path}`, { method, headers, body: payload })
    if (res.status === 401 || res.status === 403) throw new Error('AUTH')
    if (!res.ok) throw new Error(`${path} → ${res.status}`)
    if (raw) return res
    return res.json()
  }

  SH.api = {
    normHub,

    /* First-run connection test against a cheap authed endpoint. Returns a
       shaped result instead of throwing so the options page can display it. */
    async validate(hubUrl, token) {
      const w = { hubUrl: normHub(hubUrl), token }
      try {
        const cur = await req('/api/snapshot/current', { auth: w })
        return { ok: true, version: cur.version, workCount: cur.work_count }
      } catch (e) {
        if (e.message === 'AUTH') return { ok: false, error: 'Invalid token' }
        return { ok: false, error: e.message || 'Connection failed' }
      }
    },

    getCurrentSnapshot() {
      return req('/api/snapshot/current')
    },

    async getSnapshotFile() {
      const res = await req('/api/snapshot/file', { raw: true })
      return res.arrayBuffer()
    },

    /* --- capture (§12.1, amended) --- */

    // POST raw metadata -> { queue_item, needs_review }. Creates the queue item;
    // the epub follows via uploadEpub.
    capture(payload) {
      return req('/api/queue', { method: 'POST', body: payload })
    },

    // POST epub bytes the content script fetched from AO3 -> Railway stages to R2
    // and commits. (AO3's Cloudflare blocks both the extension SW fetch and a
    // Railway-side fetch, so only the page-context content-script fetch works.)
    uploadEpub(queueItemId, bytes) {
      return req(`/api/queue/${queueItemId}/epub`, {
        method: 'POST',
        rawBody: bytes,
        contentType: 'application/epub+zip',
      })
    },

    // Deliberate status/favorite write (§12.2). patch = {read_status?, is_favorite?,
    // date_read?, pinned?}.
    patchWork(workId, patch) {
      return req(`/api/works/${workId}`, { method: 'PATCH', body: patch })
    },

    /* --- unified pending-changes queue (pending-queue redesign, supersedes the
       §12.2 ao3_actions drain). Every AO3 action becomes a pending item; the drawer
       applies the AO3 side and acks it. Nothing is performed on click. --- */

    // Create a queue item (origin 'ao3'). body = {work_id, action, origin, title?, author?}.
    createPending(body) {
      return req('/api/pending', { method: 'POST', body })
    },
    // Open items; side='ao3' narrows to what the drawer must apply.
    listPending(side) {
      return req(`/api/pending${side ? `?side=${side}` : ''}`)
    },
    cancelPending(id) {
      return req(`/api/pending/${id}`, { method: 'DELETE', raw: true })
    },
    // Captures awaiting a PC epub fetch: PWA paste-a-URL / share stubs + any capture
    // whose epub fetch failed (staging_key IS NULL). The drawer runs the content-
    // script capture on each work_id, which supersedes the row with the completed
    // (metadata + epub) capture.
    fetchQueue() {
      return req('/api/pending/fetch-queue')
    },
    // Queue a NEW work for capture (held, not committed) + upload its epub bytes.
    capturePending(payload) {
      return req('/api/pending/capture', { method: 'POST', body: payload })
    },
    uploadPendingEpub(id, bytes) {
      return req(`/api/pending/${id}/epub`, {
        method: 'POST',
        rawBody: bytes,
        contentType: 'application/epub+zip',
      })
    },
    // Mark an item's AO3 side after performing it. result = 'done' | 'pending'.
    ackAo3(id, result, error) {
      const q = `?result=${result}` + (error ? `&error=${encodeURIComponent(error)}` : '')
      return req(`/api/pending/${id}/ack-ao3${q}`, { method: 'POST' })
    },

    // Backfill is_favorite from the AO3 bookmark set (the bookmarks were never
    // reconciled at migration — favorites came from Calibre only). Sets is_favorite +
    // forces Read for each supplied work in the library; returns
    // {favorited, already, newly_read, not_in_library, snapshot_version?}. Rebuilds
    // the snapshot server-side, so no separate rebuild call is needed.
    reconcileFavorites(workIds) {
      return req('/api/works/reconcile-favorites', { method: 'POST', body: { work_ids: workIds } })
    },

    // Rebuild the snapshot from current Postgres state (+ version bump). Debounced
    // by the SW after capture/status bursts so clients pick it up on next sync.
    rebuildSnapshot() {
      return req('/api/snapshot/build', { method: 'POST' })
    },
  }
})()
