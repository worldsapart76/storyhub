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
const REBUILD_ALARM = 'storyhub-snapshot-rebuild'
const REBUILD_DEBOUNCE_MIN = 1 // coalesce a burst of captures into one rebuild

/* Debounce a snapshot rebuild: content scripts signal after a capture / work-page
   status change; resetting the alarm on each signal means a burst of additions
   (e.g. clicking through many AO3 tabs) triggers a single rebuild ~1 min after the
   last one, not one per work. Survives the SW being killed (chrome.alarms). */
function scheduleRebuild() {
  chrome.alarms.create(REBUILD_ALARM, { delayInMinutes: REBUILD_DEBOUNCE_MIN })
}

async function rebuildSnapshot() {
  if (!(await SH.storage.isConfigured())) return
  try {
    const r = await SH.api.rebuildSnapshot()
    console.info('[StoryHub] snapshot rebuilt → v' + r.version, `(${r.work_count} works)`)
  } catch (e) {
    console.warn('[StoryHub] rebuild failed:', e.message)
  }
}

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
  else if (alarm.name === REBUILD_ALARM) rebuildSnapshot()
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
        case 'sync':
          // Non-forced: only downloads if the snapshot version bumped. Content
          // scripts fire this on AO3 page load so the injected badge reflects the
          // latest committed library state (e.g. a status change applied in the PWA)
          // instead of waiting for the hourly sync alarm.
          sendResponse(await syncIfConfigured(false))
          break
        case 'scheduleRebuild':
          scheduleRebuild()
          sendResponse({ ok: true })
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
