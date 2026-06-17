/* LibraryProvider — loads the snapshot once and exposes works + the sql.js DB
   handle (for relational queries: Tag Management, etc.) via useLibrary().

   Writes: update() does an optimistic in-memory change, persists it to the local
   overlay (so it survives refresh before the snapshot rebuilds), and PATCHes
   Railway. On failure it rolls everything back and surfaces the error. */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Database } from 'sql.js'
import { loadSnapshotDb } from './snapshot'
import { readWorks } from './mappers'
import { deleteEdit, loadOverlay, reconcile, saveEdit, type Edit } from './overlay'
import { enqueueWorkPatch, flushQueue, queueSize } from './queue'
import type { Work } from './types'

type LibraryState = {
  works: Work[]
  db: Database | null
  version: number
  loading: boolean
  error: string | null
  reload: () => void
  /** Optimistic status/favorite/pin write — applied locally, queued, and synced
      to Railway (queued offline, flushed on reconnect). Resolves null on success. */
  update: (workId: number, edit: Edit) => Promise<string | null>
  /** Number of writes made locally that haven't synced to the hub yet. */
  pending: number
}

const Ctx = createContext<LibraryState | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Omit<LibraryState, 'reload' | 'update' | 'pending'>>({
    works: [], db: null, version: 0, loading: true, error: null,
  })
  const [pending, setPending] = useState(0)
  const overlayRef = useRef<Map<number, Edit>>(new Map())

  const load = () => {
    setS((p) => ({ ...p, loading: true, error: null }))
    Promise.all([loadSnapshotDb(), loadOverlay()])
      .then(({ 0: { db, version }, 1: overlay }) => {
        // A snapshot that already reflects an edit means the server has it → prune
        // that overlay entry. Still-pending offline edits sit on an OLDER snapshot,
        // so they won't match and are kept (and the queue still syncs them).
        const { works, stale } = reconcile(readWorks(db), overlay)
        stale.forEach((id) => { overlay.delete(id); void deleteEdit(id) })
        overlayRef.current = overlay
        setS({ works, db, version, loading: false, error: null })
      })
      .catch((e) =>
        setS((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : String(e) })))
  }

  const flush = () => flushQueue().then((r) => setPending(r.remaining)).catch(() => {})

  useEffect(() => {
    load()
    queueSize().then(setPending).catch(() => {})
    if (navigator.onLine) flush()
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [])

  const update = async (workId: number, edit: Edit): Promise<string | null> => {
    // Unread is allowed as a DELIBERATE app correction (re-marks for later on AO3
    // in Phase E). The "never clobber to Unread" protection lives on import, not here.
    // Optimistic: patch in memory + overlay (the display layer)…
    setS((p) => ({ ...p, works: p.works.map((w) => (w.workId === workId ? { ...w, ...edit } : w)) }))
    const merged = { ...overlayRef.current.get(workId), ...edit }
    overlayRef.current.set(workId, merged)
    await saveEdit(workId, merged)
    // …then queue the server write and try to flush now (no-op/queued if offline).
    await enqueueWorkPatch(workId, edit)
    const r = await flushQueue()
    setPending(r.remaining)
    return null
  }

  return <Ctx.Provider value={{ ...s, reload: load, update, pending }}>{children}</Ctx.Provider>
}

export function useLibrary(): LibraryState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useLibrary must be used within LibraryProvider')
  return c
}
