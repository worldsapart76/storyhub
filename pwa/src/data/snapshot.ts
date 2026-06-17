/* Snapshot loading: check the content version, reuse the IndexedDB cache when it
   matches, else download the SQLite from the authenticated Railway endpoint
   (§12.3 / Phase F1). Parses it with sql.js (WASM). */

import initSqlJs, { type Database, type SqlJsStatic } from 'sql.js'
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url'
import { authHeaders, getHub } from './config'
import { getCachedSnapshot, putCachedSnapshot } from './idb'

let _sql: SqlJsStatic | null = null
async function getSql(): Promise<SqlJsStatic> {
  if (!_sql) _sql = await initSqlJs({ locateFile: () => wasmUrl })
  return _sql
}

export type LoadedSnapshot = { db: Database; version: number }

export async function loadSnapshotDb(force = false): Promise<LoadedSnapshot> {
  const hub = getHub()
  const cur = await fetch(`${hub}/api/snapshot/current`, { headers: authHeaders() })
  if (cur.status === 401 || cur.status === 403) throw new Error('AUTH')
  if (!cur.ok) throw new Error(`snapshot/current → ${cur.status}`)
  const { version } = (await cur.json()) as { version: number }

  const cached = await getCachedSnapshot()
  let bytes: ArrayBuffer
  if (!force && cached && cached.version === version) {
    bytes = cached.bytes
  } else {
    const res = await fetch(`${hub}/api/snapshot/file`, { headers: authHeaders() })
    if (!res.ok) throw new Error(`snapshot/file → ${res.status}`)
    bytes = await res.arrayBuffer()
    await putCachedSnapshot(version, bytes)
  }

  const sql = await getSql()
  return { db: new sql.Database(new Uint8Array(bytes)), version }
}

/* Snapshot rebuild + "pending" tracking. Curation that changes the projection
   (tag category / exclude / synonym / group, category set) only reaches Browse
   after a rebuild — so Tag Management marks the snapshot dirty on those writes and
   offers an in-app rebuild, instead of relying on the user to remember / a CLI.
   The flag is localStorage-backed so it survives tab switches and reloads. */
const DIRTY_KEY = 'storyhub.snapshotDirty'
const DIRTY_EVT = 'storyhub-snapshot-dirty'

export const isSnapshotDirty = (): boolean => localStorage.getItem(DIRTY_KEY) === '1'

export function markSnapshotDirty(): void {
  if (isSnapshotDirty()) return
  localStorage.setItem(DIRTY_KEY, '1')
  window.dispatchEvent(new Event(DIRTY_EVT))
}

export function clearSnapshotDirty(): void {
  if (!isSnapshotDirty()) return
  localStorage.removeItem(DIRTY_KEY)
  window.dispatchEvent(new Event(DIRTY_EVT))
}

export function onSnapshotDirtyChange(cb: () => void): () => void {
  window.addEventListener(DIRTY_EVT, cb)
  return () => window.removeEventListener(DIRTY_EVT, cb)
}

/* Rebuild the snapshot from current Postgres state (Railway re-projects + bumps
   the version). Clears the dirty flag on success; the caller reloads the library
   so the new version is fetched. */
export async function rebuildSnapshot(): Promise<void> {
  const res = await fetch(`${getHub()}/api/snapshot/build`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
  clearSnapshotDirty()
}
