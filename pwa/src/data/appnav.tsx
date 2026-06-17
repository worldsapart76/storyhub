/* App-level navigation + a one-shot "apply this filter on Browse" hand-off, so
   the Saved Filters surface can send a filter to Browse and switch to it. */

import { createContext, useContext, useState, type ReactNode } from 'react'
import type { FilterState } from './filters'

export type PendingApply = { filter: FilterState; sort?: string } | null

type Nav = {
  active: string
  navigate: (id: string) => void
  pending: PendingApply
  applyFilterToBrowse: (filter: FilterState, sort?: string) => void
  consumePending: () => void
}

const Ctx = createContext<Nav | null>(null)

export function NavProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState('browse')
  const [pending, setPending] = useState<PendingApply>(null)

  const applyFilterToBrowse = (filter: FilterState, sort?: string) => {
    setPending({ filter, sort })
    setActive('browse')
  }

  return (
    <Ctx.Provider value={{ active, navigate: setActive, pending, applyFilterToBrowse, consumePending: () => setPending(null) }}>
      {children}
    </Ctx.Provider>
  )
}

export function useNav(): Nav {
  const c = useContext(Ctx)
  if (!c) throw new Error('useNav must be used within NavProvider')
  return c
}
