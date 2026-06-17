/* Options / first-run setup. Validates the hub+token against the background
   worker (which holds sql.js), saves config, and triggers a snapshot sync.
   chrome.runtime.sendMessage is promisified in MV3. */
(function () {
  const SH = globalThis.SH
  const DEFAULT_HUB = 'https://ffstoryhub.up.railway.app'

  const $ = (id) => document.getElementById(id)
  const hubUrl = $('hubUrl')
  const token = $('token')
  const result = $('result')
  const save = $('save')

  function setResult(text, cls) {
    result.textContent = text
    result.className = `result ${cls || ''}`.trim()
  }

  function renderStatus(meta) {
    $('snapVersion').textContent = meta ? `v${meta.version}` : '—'
    $('snapCount').textContent = meta ? meta.workCount.toLocaleString() : '—'
    $('snapSynced').textContent = meta?.syncedAt
      ? new Date(meta.syncedAt).toLocaleString()
      : '—'
  }

  async function refreshStatus() {
    const { meta } = await chrome.runtime.sendMessage({ type: 'getStatus' })
    renderStatus(meta)
  }

  async function init() {
    const cfg = await SH.storage.getConfig()
    hubUrl.value = cfg?.hubUrl || DEFAULT_HUB
    token.value = cfg?.token || ''
    await refreshStatus()
  }

  $('setup').addEventListener('submit', async (e) => {
    e.preventDefault()
    const url = SH.api.normHub(hubUrl.value)
    const tok = token.value.trim()
    if (!url || !tok) {
      setResult('Enter hub URL and token', 'err')
      return
    }
    save.disabled = true
    setResult('Validating…')
    const res = await chrome.runtime.sendMessage({ type: 'validate', hubUrl: url, token: tok })
    if (res.ok) {
      await SH.storage.setConfig({ hubUrl: url, token: tok })
      setResult(`Connected — v${res.version}`, 'ok')
      const sync = await chrome.runtime.sendMessage({ type: 'syncNow' })
      if (sync?.error) setResult(`Saved, sync failed: ${sync.error}`, 'err')
      await refreshStatus()
    } else {
      setResult(res.error || 'Failed', 'err')
    }
    save.disabled = false
  })

  $('syncNow').addEventListener('click', async () => {
    setResult('Syncing…')
    const res = await chrome.runtime.sendMessage({ type: 'syncNow' })
    if (res?.error) setResult(`Sync failed: ${res.error}`, 'err')
    else if (res?.skipped) setResult('Configure first', 'err')
    else setResult(res.updated ? `Synced v${res.version}` : `Up to date (v${res.version})`, 'ok')
    await refreshStatus()
  })

  init()
})()
