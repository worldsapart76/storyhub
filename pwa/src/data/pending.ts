/* Unified pending-changes queue client (pending-queue redesign). Every status /
   favorite action becomes a queue item via the hub; nothing is applied until the
   user hits "Apply to Library" on the Pending page. Replaces the old optimistic
   write path (overlay + offline queue + ao3 side-effect enqueue). */

import { authHeaders, getHub } from './config'
import type { Edit } from './overlay'

export type PendingAction =
  | 'capture' | 'mark_read' | 'mark_unread' | 'mark_dnf' | 'favorite' | 'unfavorite'
export type PendingSide = 'pending' | 'done' | 'na'

export type PendingItem = {
  id: string
  workId: number
  action: PendingAction
  title: string | null
  author: string | null
  ao3State: PendingSide
  libraryState: PendingSide
  origin: 'ao3' | 'pwa'
  error: string | null
  createdAt: string
  // For captures only: why Apply will skip this row (epub still staging / awaiting
  // primary review). null = ready to commit. Status/favorite items are always ready.
  notReady: string | null
}

/* Short verb for toasts + the queue list. */
export const ACTION_LABEL: Record<PendingAction, string> = {
  capture: 'Add',
  mark_read: 'Mark Read',
  mark_unread: 'Mark Unread',
  mark_dnf: 'Mark DNF',
  favorite: 'Favorite',
  unfavorite: 'Un-favorite',
}

/* Map a single-field Edit (from a card) to a queue action. Returns null for `pinned`
   — pinning is library-only offline caching, handled by a direct write, not the
   AO3-sync queue. */
export function actionForEdit(edit: Edit): PendingAction | null {
  if (edit.readStatus === 'Read') return 'mark_read'
  if (edit.readStatus === 'Unread') return 'mark_unread'
  if (edit.readStatus === 'DNF') return 'mark_dnf'
  if (edit.isFavorite === true) return 'favorite'
  if (edit.isFavorite === false) return 'unfavorite'
  return null
}

type RawPayload =
  | { needs_fetch?: boolean; proposals?: { epub_staged?: boolean; auto?: boolean; approved?: boolean } }
  | null

/* Mirror the server's apply-skip rules (pending.py _apply_library_one) so the queue
   can explain, before you click Apply, why a capture isn't ready to commit yet. */
function captureNotReady(action: PendingAction, payload: RawPayload): string | null {
  if (action !== 'capture') return null
  // A stub added by URL/share: the PC hasn't fetched its metadata + epub yet.
  if (payload?.needs_fetch) return 'awaiting PC fetch'
  const p = payload?.proposals || {}
  if (!p.epub_staged) return 'epub still uploading'
  if (!(p.auto || p.approved)) return 'needs primary review'
  return null
}

function mapItem(q: {
  id: string; work_id: number; action: PendingAction; title: string | null;
  author: string | null; ao3_state: PendingSide; library_state: PendingSide;
  origin: 'ao3' | 'pwa'; error: string | null; created_at: string; payload?: RawPayload
}): PendingItem {
  return {
    id: q.id, workId: q.work_id, action: q.action, title: q.title, author: q.author,
    ao3State: q.ao3_state, libraryState: q.library_state, origin: q.origin,
    error: q.error, createdAt: q.created_at,
    notReady: captureNotReady(q.action, q.payload ?? null),
  }
}

export async function createPending(
  workId: number, action: PendingAction, opts: { title?: string; author?: string } = {},
): Promise<void> {
  const res = await fetch(`${getHub()}/api/pending`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_id: workId, action, origin: 'pwa', ...opts }),
  })
  if (!res.ok) throw new Error(`queue → ${res.status} ${await res.text().catch(() => '')}`.trim())
}

export type CaptureRequestResult = {
  status: 'queued' | 'already_queued' | 'already_in_library'
  work_id: number
}

/* "Add by URL" / share target. The server parses an AO3 work URL (or a bare id)
   and leaves a capture STUB; the PC fills in metadata + epub later. */
export async function requestCapture(input: string): Promise<CaptureRequestResult> {
  const res = await fetch(`${getHub()}/api/pending/request-capture`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: input.trim() }),
  })
  if (!res.ok) throw new Error(`add → ${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.json()
}

export async function fetchPending(side?: 'ao3' | 'library'): Promise<PendingItem[]> {
  const url = `${getHub()}/api/pending${side ? `?side=${side}` : ''}`
  const res = await fetch(url, { headers: authHeaders() })
  if (!res.ok) throw new Error(`pending → ${res.status}`)
  return ((await res.json()) as Parameters<typeof mapItem>[0][]).map(mapItem)
}

export async function fetchPendingCount(): Promise<number> {
  return (await fetchPending()).length
}

export async function cancelPending(id: string): Promise<void> {
  const res = await fetch(`${getHub()}/api/pending/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok && res.status !== 404) throw new Error(`cancel → ${res.status}`)
}

export async function applyLibrary(): Promise<{ applied: number; failed: number; skipped: number; snapshot_version?: number }> {
  const res = await fetch(`${getHub()}/api/pending/apply-library`, { method: 'POST', headers: authHeaders() })
  if (!res.ok) throw new Error(`apply → ${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.json()
}
