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

    /* --- ao3_actions drain (§12.2) --- */

    // Pending AO3 side-effects the app enqueued; the extension performs + acks them.
    listPendingAo3Actions() {
      return req('/api/ao3-actions?status=pending')
    },
    // result = 'done' | 'failed'.
    ackAo3Action(id, result) {
      return req(`/api/ao3-actions/${id}/ack?result=${result}`, { method: 'POST' })
    },

    // Rebuild the snapshot from current Postgres state (+ version bump). Debounced
    // by the SW after capture/status bursts so clients pick it up on next sync.
    rebuildSnapshot() {
      return req('/api/snapshot/build', { method: 'POST' })
    },
  }
})()
