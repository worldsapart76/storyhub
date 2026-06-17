/* Local-edit overlay. The snapshot (R2 → IndexedDB) is read-only and only
   reflects status/favorite/pin changes after a server-side rebuild. To make
   optimistic writes survive a refresh in the meantime, every committed edit is
   also stored here (its own IndexedDB) and re-applied over the snapshot on load.
   When a newer snapshot already carries the edit, the entry is pruned. */

import type { ReadStatus, Work } from './types'

export type Edit = Partial<{ readStatus: ReadStatus; isFavorite: boolean; pinned: boolean }>

const DB_NAME = 'storyhub-edits'
const STORE = 'edits'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function loadOverlay(): Promise<Map<number, Edit>> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE)
    const keys = tx.getAllKeys()
    const vals = tx.getAll()
    tx.transaction.oncomplete = () => {
      const map = new Map<number, Edit>()
      ;(keys.result as number[]).forEach((k, i) => map.set(k, (vals.result as Edit[])[i]))
      resolve(map)
    }
    tx.transaction.onerror = () => reject(tx.transaction.error)
  })
}

export async function saveEdit(workId: number, edit: Edit): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(edit, workId)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

export async function deleteEdit(workId: number): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(workId)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

function fullyApplied(work: Work, edit: Edit): boolean {
  return (Object.keys(edit) as (keyof Edit)[]).every((k) => work[k] === edit[k])
}

/* Merge edits over the snapshot works; return the merged list plus the ids whose
   edit the snapshot has caught up on (safe to delete so the overlay stays small). */
export function reconcile(works: Work[], overlay: Map<number, Edit>): { works: Work[]; stale: number[] } {
  if (overlay.size === 0) return { works, stale: [] }
  const stale: number[] = []
  const merged = works.map((w) => {
    const edit = overlay.get(w.workId)
    if (!edit) return w
    if (fullyApplied(w, edit)) { stale.push(w.workId); return w }
    return { ...w, ...edit }
  })
  return { works: merged, stale }
}
