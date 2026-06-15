/* LibraryProvider — loads the snapshot once and exposes works + the sql.js DB
   handle (for relational queries: Tag Management, etc.) via useLibrary(). */

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Database } from 'sql.js'
import { loadSnapshotDb } from './snapshot'
import { readWorks } from './mappers'
import type { Work } from './types'

type LibraryState = {
  works: Work[]
  db: Database | null
  version: number
  loading: boolean
  error: string | null
  reload: () => void
}

const Ctx = createContext<LibraryState | null>(null)

export function LibraryProvider({ children }: { children: ReactNode }) {
  const [s, setS] = useState<Omit<LibraryState, 'reload'>>({
    works: [], db: null, version: 0, loading: true, error: null,
  })

  const load = () => {
    setS((p) => ({ ...p, loading: true, error: null }))
    loadSnapshotDb()
      .then(({ db, version }) =>
        setS({ works: readWorks(db), db, version, loading: false, error: null }))
      .catch((e) =>
        setS((p) => ({ ...p, loading: false, error: e instanceof Error ? e.message : String(e) })))
  }

  useEffect(load, [])

  return <Ctx.Provider value={{ ...s, reload: load }}>{children}</Ctx.Provider>
}

export function useLibrary(): LibraryState {
  const c = useContext(Ctx)
  if (!c) throw new Error('useLibrary must be used within LibraryProvider')
  return c
}
