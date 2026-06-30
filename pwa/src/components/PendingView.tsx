import { useEffect, useState, type FormEvent } from 'react'
import './PendingView.css'
import { ACTION_LABEL, applyLibrary, cancelPending, fetchPending, requestCapture, type PendingItem, type PendingSide } from '../data/pending'
import { useLibrary } from '../data/library'
import { toast } from '../data/toast'
import { Button } from './Button'

/* The unified Pending queue (pending-queue redesign). Every status/favorite/capture
   action lands here from either surface; nothing is committed until you Apply.
   "Apply to Library" commits the library side + rebuilds the snapshot; the AO3 side
   is applied from the extension's on-AO3 drawer. Each row is self-describing. */

const SIDE_LABEL: Record<PendingSide, string> = { pending: 'queued', done: '✓', na: 'n/a' }

export function PendingView() {
  const lib = useLibrary()
  const [items, setItems] = useState<PendingItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [addUrl, setAddUrl] = useState('')
  const [adding, setAdding] = useState(false)

  function load() {
    setItems(null)
    setError(null)
    fetchPending().then(setItems).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(load, [])

  async function cancel(it: PendingItem) {
    try {
      await cancelPending(it.id)
      setItems((prev) => (prev ? prev.filter((x) => x.id !== it.id) : prev))
      toast('Cancelled')
    } catch (e) {
      toast(`Cancel failed: ${e instanceof Error ? e.message : e}`, 'err')
    }
  }

  async function add(e: FormEvent) {
    e.preventDefault()
    const val = addUrl.trim()
    if (!val || adding) return
    setAdding(true)
    try {
      const r = await requestCapture(val)
      if (r.status === 'queued') {
        toast(`Queued work ${r.work_id} — fetch it on your PC`, 'ok')
        setAddUrl('')
        load()
      } else if (r.status === 'already_queued') {
        toast(`Work ${r.work_id} is already queued`, 'warn')
        setAddUrl('')
      } else {
        toast(`Work ${r.work_id} is already in your library`, 'warn')
        setAddUrl('')
      }
    } catch (err) {
      toast(`Add failed: ${err instanceof Error ? err.message : err}`, 'err')
    } finally {
      setAdding(false)
    }
  }

  async function apply() {
    setBusy(true)
    try {
      const r = await applyLibrary()
      const parts = [`Applied ${r.applied}`]
      if (r.skipped) parts.push(`${r.skipped} not ready`)
      if (r.failed) parts.push(`${r.failed} failed`)
      toast(parts.join(' · '), r.failed ? 'err' : r.skipped ? 'warn' : 'ok')
      await lib.reload() // pull the freshly-rebuilt snapshot into Browse
      load()
    } catch (e) {
      toast(`Apply failed: ${e instanceof Error ? e.message : e}`, 'err')
    } finally {
      setBusy(false)
    }
  }

  const libraryPending = items?.filter((i) => i.libraryState === 'pending').length ?? 0

  return (
    <div className="pv">
      <header className="pv__head">
        <h1 className="pv__title">Pending</h1>
        <div className="pv__headactions">
          <button className="pv__refresh" onClick={load} disabled={items === null && !error} title="Refresh">↻</button>
          <Button variant="primary" size="md" disabled={busy || libraryPending === 0} onClick={apply}>
            {busy ? 'Applying…' : `Apply to Library${libraryPending ? ` · ${libraryPending}` : ''}`}
          </Button>
        </div>
      </header>

      <p className="pv__hint">
        Library changes commit here; AO3 changes apply from the extension drawer on an AO3 page.
      </p>

      <form className="pv__add" onSubmit={add}>
        <input
          className="pv__addinput"
          type="text"
          inputMode="url"
          placeholder="Paste AO3 work URL to add…"
          value={addUrl}
          onChange={(e) => setAddUrl(e.target.value)}
          disabled={adding}
        />
        <Button variant="primary" size="md" type="submit" disabled={adding || !addUrl.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </Button>
      </form>

      {error ? (
        <div className="pv__state pv__state--err">Couldn’t load the queue: {error}</div>
      ) : items === null ? (
        <div className="pv__state">Loading…</div>
      ) : items.length === 0 ? (
        <div className="pv__state">Queue is clear — nothing pending.</div>
      ) : (
        <ul className="pv__list">
          {items.map((it) => (
            <li key={it.id} className="pv__item">
              <div className="pv__main">
                <div className="pv__row1">
                  <span className={'pv__action pv__action--' + it.action}>{ACTION_LABEL[it.action]}</span>
                  <a className="pv__worktitle" href={`https://archiveofourown.org/works/${it.workId}`} target="_blank" rel="noreferrer">
                    {it.title || `(work ${it.workId})`}
                  </a>
                </div>
                <div className="pv__meta">
                  {it.author && <span className="pv__author">by {it.author}</span>}
                  <span className={'pv__side pv__side--' + it.libraryState}>Library: {SIDE_LABEL[it.libraryState]}</span>
                  <span className={'pv__side pv__side--' + it.ao3State}>AO3: {SIDE_LABEL[it.ao3State]}</span>
                  <span className="pv__origin">from {it.origin === 'ao3' ? 'AO3' : 'app'}</span>
                  {it.notReady && it.libraryState === 'pending' && (
                    <span className="pv__notready" title="Apply skips this until it's ready">⏳ {it.notReady}</span>
                  )}
                  <span className="pv__time">{new Date(it.createdAt).toLocaleString()}</span>
                </div>
                {it.error && <div className="pv__err">{it.error}</div>}
              </div>
              <button className="pv__cancel" onClick={() => cancel(it)} title="Cancel this item">Cancel</button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
