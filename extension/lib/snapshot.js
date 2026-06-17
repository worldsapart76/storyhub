/* Snapshot sync (background worker only — depends on sql.js, loaded via
   importScripts). Mirrors the PWA's strategy (docs/components/extension.md
   "Snapshot caching"): hit /snapshot/current, and if the content version differs
   from what we have, download /snapshot/file and project a compact badge map
   (work_id -> {status, fav, availability}) from work_cards. Content scripts read
   that map from storage with no network and no WASM. */
(function () {
  const SH = (globalThis.SH = globalThis.SH || {})

  let _sql = null
  async function getSql() {
    if (!_sql) {
      // initSqlJs is defined by vendor/sql-wasm.js (importScripts'd in the SW).
      _sql = await initSqlJs({ locateFile: () => chrome.runtime.getURL('vendor/sql-wasm.wasm') })
    }
    return _sql
  }

  function projectBadgeMap(bytes) {
    const SQL = _sql
    const db = new SQL.Database(new Uint8Array(bytes))
    try {
      const map = {}
      const res = db.exec(
        'SELECT work_id, read_status, is_favorite, availability FROM work_cards'
      )
      if (res.length) {
        for (const row of res[0].values) {
          const [wid, status, fav, avail] = row
          map[wid] = { s: status, f: fav ? 1 : 0, a: avail }
        }
      }
      return map
    } finally {
      db.close()
    }
  }

  SH.snapshot = {
    /* Returns { updated, version, workCount }. Skips the download when the local
       badge map is already on the current version (unless force). */
    async sync({ force = false } = {}) {
      const cur = await SH.api.getCurrentSnapshot()
      const meta = await SH.storage.getSnapshotMeta()
      if (!force && meta && meta.version === cur.version) {
        return { updated: false, version: cur.version, workCount: meta.workCount }
      }
      await getSql()
      const bytes = await SH.api.getSnapshotFile()
      const map = projectBadgeMap(bytes)
      await SH.storage.setBadgeMap(map)
      const workCount = Object.keys(map).length
      await SH.storage.setSnapshotMeta({
        version: cur.version,
        workCount,
        syncedAt: new Date().toISOString(),
      })
      return { updated: true, version: cur.version, workCount }
    },
  }
})()
