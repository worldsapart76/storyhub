/* LibraryProvider — loads the snapshot once and exposes works + the sql.js DB
   handle (for relational queries: Tag Management, etc.) via useLibrary().

   Writes (pending-queue redesign): status/favorite changes are NOT applied
   optimistically — `update()` creates a pending-queue item (reviewed + committed
   later on the Pending page), so Browse always shows committed snapshot state and
   the old overlay/divergence is gone. `pinned` is the exception: it's library-only
   offline caching with no AO3 side, so it's written directly + reflected at once. */

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Database } from 'sql.js'
import { loadSnapshotDb } from './snapshot'
import { readWorks } from './mappers'
import { patchWork } from './api'
import { ACTION_LABEL, actionForEdit, createPending } from './pending'
import { toast } from './toast'
import { type Edit } from './overlay'
import type { Work } from './types'

type LibraryState = {
  works: Work[]
  db: Database | null
  version: number
  loading: boolean
  error: string | null
  reload: () => void
  /** Queue a status/favorite change (review + Apply on the Pending page) or write a
      pin directly. Resolves an error string on failure, else null. */
  update: (workId: number, edit: Edit) => Promise<string | null>
  /** Optimistically merge fields into a work already in state (the caller has
      already persisted the change server-side) — e.g. a primary-ship/collection edit
      that won't reach the snapshot until a rebuild. */
  patchLocal: (workId: number, partial: Partial<Work>) => void
}

const Ctx = createContext<LibraryState | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Omit<LibraryState, 'reload' | 'update' | 'patchLocal'>>({
    works: [], db: null, version: 0, loading: true, error: null,
  })
  const worksRef = useRef<Work[]>([])
  worksRef.current = s.works

  const load = () => {
    setS((p) => ({ ...p, loading: true, error: null }))
    loadSnapshotDb()
      .then(({ db, version }) => setS({ works: readWorks(db), db, version, loading: false, error: null }))
      .catch((e) =>
        setS((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : String(e) })))
  }

  useEffect(load, [])

  const update = async (workId: number, edit: Edit): Promise<string | null> => {
    const work = worksRef.current.find((w) => w.workId === workId)
    const titleNote = work ? ` — ${work.title}` : ''

    // Pin: library-only offline caching, no AO3 side, no divergence — write directly
    // and reflect immediately.
    if (edit.pinned !== undefined) {
      setS((p) => ({ ...p, works: p.works.map((w) => (w.workId === workId ? { ...w, pinned: edit.pinned! } : w)) }))
      const r = await patchWork(workId, { pinned: edit.pinned })
      if (!r.ok) {
        setS((p) => ({ ...p, works: p.works.map((w) => (w.workId === workId ? { ...w, pinned: !edit.pinned } : w)) }))
        toast(`Pin failed: ${r.error}`, 'err')
        return r.error
      }
      return null
    }

    // Status / favorite: queue it; nothing changes until "Apply to Library".
    const action = actionForEdit(edit)
    if (!action) return null
    try {
      await createPending(workId, action, { title: work?.title, author: work?.authors?.[0] })
      toast(`Queued: ${ACTION_LABEL[action]}${titleNote}`)
      return null
    } catch (e) {
      const m = e instanceof Error ? e.message : String(e)
      toast(`Queue failed: ${m}`, 'err')
      return m
    }
  }

  const patchLocal = (workId: number, partial: Partial<Work>) =>
    setS((p) => ({ ...p, works: p.works.map((w) => (w.workId === workId ? { ...w, ...partial } : w)) }))

  return <Ctx.Provider value={{ ...s, reload: load, update, patchLocal }}>{children}</Ctx.Provider>
}

export function useLibrary(): LibraryState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useLibrary must be used within LibraryProvider')
  return c
}
