/* localStorage-backed useState. Per-page UI state (filters, search, sort) persists
   across BOTH unmount→remount (navigating between pages) AND a full app reload —
   e.g. Android killing the backgrounded PWA while you read a story in Chrome. The
   value must be JSON-serializable. Same API as useState, including functional
   updates. Cleared by the user's own "Clear all" / filter resets, never silently. */

import { useEffect, useState, type Dispatch, type SetStateAction } from 'react'

export function usePersistentState<T>(
  key: string, initial: T | (() => T),
): [T, Dispatch<SetStateAction<T>>] {
  const [value, setValue] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key)
      if (raw != null) return JSON.parse(raw) as T
    } catch { /* unreadable / private mode → fall through to initial */ }
    return initial instanceof Function ? (initial as () => T)() : initial
  })

  useEffect(() => {
    try { localStorage.setItem(key, JSON.stringify(value)) } catch { /* quota / private mode */ }
  }, [key, value])

  return [value, setValue]
}
