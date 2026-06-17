/* E4 — drain the ao3_actions queue on any AO3 page load (redesign §12.2). The app
   (PWA) writes works directly and enqueues the AO3 side-effect; the extension is
   the only client with an AO3 session, so it performs each pending action here
   (same-origin authed POST) and acks it done/failed. The only automatic on-AO3
   behavior — it performs only what you already chose in the app.

   Read-status actions (mark_read / mark_for_later) are supported now; bookmark /
   remove_bookmark land with the bookmark chunk (left pending until then, never
   silently dropped). A short storage lock keeps multiple AO3 tabs from racing. */
(function () {
  const SH = globalThis.SH
  const log = (...a) => console.info('[StoryHub]', ...a)
  const LOCK_KEY = 'drainLock'
  const LOCK_TTL = 30000

  const HANDLERS = {
    mark_read: (wid) => SH.ao3.markAsRead(wid),
    mark_for_later: (wid) => SH.ao3.markForLater(wid),
    // bookmark / remove_bookmark: added with the bookmark chunk
  }

  async function acquireLock() {
    const { [LOCK_KEY]: lock } = await chrome.storage.local.get(LOCK_KEY)
    if (lock && Date.now() - lock < LOCK_TTL) return false
    await chrome.storage.local.set({ [LOCK_KEY]: Date.now() })
    return true
  }

  async function drain() {
    if (!(await SH.storage.isConfigured())) return
    let actions
    try {
      actions = await SH.api.listPendingAo3Actions()
    } catch (e) {
      log('drain: list failed —', e.message)
      return
    }
    if (!actions.length) return
    if (!(await acquireLock())) {
      log('drain: another tab holds the lock; skipping')
      return
    }
    log(`drain: ${actions.length} pending`)
    try {
      let skipped = 0
      for (const a of actions) {
        const handler = HANDLERS[a.action]
        if (!handler) {
          skipped++ // bookmark/remove_bookmark — leave pending for the bookmark chunk
          continue
        }
        let ok = false
        try {
          ok = await handler(a.work_id)
        } catch (e) {
          ok = false
        }
        try {
          await SH.api.ackAo3Action(a.id, ok ? 'done' : 'failed')
        } catch (e) {
          log(`drain: ack failed for ${a.id} —`, e.message)
        }
        log(`drain: ${a.action} work ${a.work_id} -> ${ok ? 'done' : 'failed'}`)
      }
      if (skipped) log(`drain: ${skipped} bookmark action(s) left pending (bookmark chunk not built)`)
    } finally {
      await chrome.storage.local.remove(LOCK_KEY)
    }
  }

  drain()
})()
