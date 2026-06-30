/* Extension-local persistence (chrome.storage.local). Holds the hub config, the
   compact badge map the background worker projects from the snapshot, and the
   snapshot sync metadata. Loaded in the service worker (importScripts), the
   options page (<script>), and content scripts (manifest js[]) — all share the
   single SH namespace. */
(function () {
  const SH = (globalThis.SH = globalThis.SH || {})

  const CONFIG_KEY = 'config' // { hubUrl, token }
  const BADGE_KEY = 'badgeMap' // { [work_id]: { s: read_status, f: 0|1, a: availability } }
  const META_KEY = 'snapshotMeta' // { version, workCount, syncedAt }

  const get = (keys) => chrome.storage.local.get(keys)
  const set = (obj) => chrome.storage.local.set(obj)

  SH.storage = {
    async getConfig() {
      const { [CONFIG_KEY]: cfg } = await get(CONFIG_KEY)
      return cfg || null
    },
    async setConfig(cfg) {
      await set({ [CONFIG_KEY]: cfg })
    },
    async isConfigured() {
      const cfg = await this.getConfig()
      return !!(cfg && cfg.hubUrl && cfg.token)
    },

    async getBadgeMap() {
      const { [BADGE_KEY]: map } = await get(BADGE_KEY)
      return map || {}
    },
    async setBadgeMap(map) {
      await set({ [BADGE_KEY]: map })
    },

    async getSnapshotMeta() {
      const { [META_KEY]: meta } = await get(META_KEY)
      return meta || null
    },
    async setSnapshotMeta(meta) {
      await set({ [META_KEY]: meta })
    },

    // AO3 default pseud id (for creating bookmarks from any page, incl. the drain).
    async getPseudId() {
      const { pseudId } = await get('pseudId')
      return pseudId || null
    },
    async setPseudId(id) {
      await set({ pseudId: id })
    },
  }
})()
