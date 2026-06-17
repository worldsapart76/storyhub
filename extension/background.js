/* StoryHub background service worker (classic — uses importScripts so the
   vendored sql.js UMD bundle loads without ESM/UMD friction). Owns snapshot sync
   and answers messages from the options page. Content-script hooks (badges,
   capture, ao3_actions drain) arrive in later Phase-E chunks. */

importScripts(
  'vendor/sql-wasm.js',
  'lib/storage.js',
  'lib/api.js',
  'lib/snapshot.js'
)

const SH = globalThis.SH

const SYNC_ALARM = 'storyhub-snapshot-sync'
const SYNC_PERIOD_MIN = 60

/* Sync the snapshot if configured; never throw out of an event handler. */
async function syncIfConfigured(force = false) {
  if (!(await SH.storage.isConfigured())) return { skipped: 'not_configured' }
  try {
    return await SH.snapshot.sync({ force })
  } catch (e) {
    console.warn('[StoryHub] snapshot sync failed:', e.message)
    return { error: e.message }
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_PERIOD_MIN })
  syncIfConfigured()
})

chrome.runtime.onStartup.addListener(() => {
  syncIfConfigured()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === SYNC_ALARM) syncIfConfigured()
})

/* Open the options page when the toolbar icon is clicked (no popup yet). */
chrome.action.onClicked.addListener(() => {
  chrome.runtime.openOptionsPage()
})

/* Messages from the options page. Returns true to keep the channel open for the
   async sendResponse. */
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  ;(async () => {
    try {
      switch (msg.type) {
        case 'validate':
          sendResponse(await SH.api.validate(msg.hubUrl, msg.token))
          break
        case 'syncNow':
          sendResponse(await syncIfConfigured(true))
          break
        case 'getStatus': {
          const [configured, meta] = await Promise.all([
            SH.storage.isConfigured(),
            SH.storage.getSnapshotMeta(),
          ])
          sendResponse({ configured, meta })
          break
        }
        default:
          sendResponse({ error: `unknown message: ${msg.type}` })
      }
    } catch (e) {
      sendResponse({ error: e.message || String(e) })
    }
  })()
  return true
})
