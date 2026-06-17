/* AO3 side-effect enqueue (redesign §12.2). When a deliberate status/favorite
   action is taken in the app (no AO3 session here), we write `works` directly AND
   enqueue the AO3 side-effect(s) in `ao3_actions`; the browser extension drains
   them on its next AO3 page load. The PWA never touches AO3 itself.

   Read-status mapping is wired now; favorite -> [mark_read, bookmark] and
   un-favorite -> remove_bookmark land with the extension's bookmark drain. */

import { authHeaders, getHub } from './config'
import type { Edit } from './overlay'

export type Ao3ActionType = 'mark_read' | 'mark_for_later' | 'bookmark' | 'remove_bookmark'

async function postAo3Action(workId: number, action: Ao3ActionType, params?: object): Promise<void> {
  await fetch(`${getHub()}/api/ao3-actions`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ work_id: workId, action, params: params ?? null }),
  })
}

/* Map a deliberate edit to its AO3 side-effect(s). Best-effort (not offline-queued
   yet — the works PATCH is, via queue.ts). Skips non-AO3 works (negative work_id =
   pre-AO3 local; nothing to sync to AO3). */
export async function enqueueAo3SideEffects(workId: number, edit: Edit): Promise<void> {
  if (workId <= 0) return // pre-AO3 local work — not on AO3

  const actions: Array<{ action: Ao3ActionType; params?: object }> = []
  if (edit.readStatus === 'Read' || edit.readStatus === 'DNF') actions.push({ action: 'mark_read' })
  else if (edit.readStatus === 'Unread') actions.push({ action: 'mark_for_later' })
  // edit.isFavorite -> bookmark side-effects: wired with the extension bookmark drain.

  for (const a of actions) {
    try {
      await postAo3Action(workId, a.action, a.params)
    } catch {
      /* best-effort; if offline the works PATCH still queues */
    }
  }
}
