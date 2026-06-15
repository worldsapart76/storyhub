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
