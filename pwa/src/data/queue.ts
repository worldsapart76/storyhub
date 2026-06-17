/* Offline write-queue. Work writes (status/favorite/pin) are enqueued here and
   flushed to Railway when online. Every write goes through the queue (not just
   offline ones) so the order is consistent and there's no online-vs-queued race:
   ops are keyed by work, so repeated edits to the same work merge to the latest
   intent. Reads + optimistic UI come from the overlay (overlay.ts); this is purely
   the pending server sync. List/saved-filter offline edits are a later addition
   (they need temp-id reconciliation for server-generated UUIDs). */

import { patchWork } from './api'
import type { Edit } from './overlay'

const DB_NAME = 'storyhub-queue'
const STORE = 'ops'

type WorkPatchOp = { type: 'work.patch'; workId: number; edit: Edit }
const keyOf = (op: WorkPatchOp) => `work:${op.workId}`

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function getAll(): Promise<{ key: string; op: WorkPatchOp }[]> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly').objectStore(STORE)
    const keys = tx.getAllKeys()
    const vals = tx.getAll()
    tx.transaction.oncomplete = () =>
      resolve((keys.result as string[]).map((k, i) => ({ key: k, op: (vals.result as WorkPatchOp[])[i] })))
    tx.transaction.onerror = () => reject(tx.transaction.error)
  }))
}

function put(key: string, op: WorkPatchOp): Promise<void> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).put(op, key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

function del(key: string): Promise<void> {
  return openDb().then((db) => new Promise((resolve, reject) => {
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).delete(key)
    req.onsuccess = () => resolve()
    req.onerror = () => reject(req.error)
  }))
}

export async function queueSize(): Promise<number> {
  return (await getAll()).length
}

/* Merge an edit into the work's queued op (last-write-wins per field). */
export async function enqueueWorkPatch(workId: number, edit: Edit): Promise<void> {
  const key = `work:${workId}`
  const existing = (await getAll()).find((e) => e.key === key)?.op
  const merged: WorkPatchOp = { type: 'work.patch', workId, edit: { ...existing?.edit, ...edit } }
  await put(keyOf(merged), merged)
}

export type FlushResult = { flushed: number; rejected: number; remaining: number }

/* Drain the queue in order. Stops at the first retryable failure (offline or 5xx)
   so order is preserved and we don't hammer a down server; drops permanent 4xx. */
export async function flushQueue(): Promise<FlushResult> {
  const ops = await getAll()
  let flushed = 0, rejected = 0
  for (const { key, op } of ops) {
    const res = await patchWork(op.workId, op.edit)
    if (res.ok) { await del(key); flushed++; continue }
    if (res.offline || (res.status && res.status >= 500)) break // retryable — leave queued
    // permanent client error (4xx): drop so it can't wedge the queue
    console.warn(`Dropping un-syncable write for work ${op.workId}: ${res.error}`)
    await del(key); rejected++
  }
  return { flushed, rejected, remaining: await queueSize() }
}
