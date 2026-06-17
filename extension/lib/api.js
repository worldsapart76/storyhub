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

  async function req(path, { method = 'GET', body, raw = false, auth } = {}) {
    const { hubUrl, token } = auth || (await creds())
    const headers = { Authorization: `Bearer ${token}` }
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    const res = await fetch(`${hubUrl}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    })
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
  }
})()
