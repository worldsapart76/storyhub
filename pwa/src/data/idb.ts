/* Minimal IndexedDB cache for the snapshot bytes + version, so the app opens
   instantly offline and only re-downloads when the content version changes. */

const DB_NAME = 'storyhub'
const STORE = 'snapshot'
const KEY = 'current'

type Cached = { version: number; bytes: ArrayBuffer }

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getCachedSnapshot(): Promise<Cached | null> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
    req.onsuccess = () => resolve((req.result as Cached) ?? null)
    req.onerror = () => reject(req.error)
  })
}

export async function putCachedSnapshot(version: number, bytes: ArrayBuffer): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put({ version, bytes }, KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}

/* Drop the cached snapshot so the next load re-downloads regardless of version —
   the recovery path for a stale/truncated local copy (Settings → Reload library). */
export async function clearCachedSnapshot(): Promise<void> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(KEY)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  })
}
