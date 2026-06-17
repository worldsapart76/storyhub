/* Hub write calls. Reads come from the snapshot; mutations go straight to Railway
   (redesign §12: any client writes read_status/is_favorite/pinned directly). */

import { authHeaders, getHub } from './config'
import type { Edit } from './overlay'

// offline = the request never reached the server (fetch threw) → safe to retry.
// status present = the server answered (an HTTP error) → a 5xx is retryable, a 4xx is not.
export type ApiResult = { ok: true } | { ok: false; error: string; offline?: boolean; status?: number }

/* PATCH /api/works/{id}. Maps the camelCase Edit to the snake_case WorkPatch. */
export async function patchWork(workId: number, edit: Edit): Promise<ApiResult> {
  const body: Record<string, unknown> = {}
  if (edit.readStatus !== undefined) body.read_status = edit.readStatus
  if (edit.isFavorite !== undefined) body.is_favorite = edit.isFavorite
  if (edit.pinned !== undefined) body.pinned = edit.pinned
  try {
    const res = await fetch(`${getHub()}/api/works/${workId}`, {
      method: 'PATCH',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (res.ok) return { ok: true }
    const detail = await res.text().catch(() => '')
    return { ok: false, status: res.status, error: `${res.status} ${detail}`.trim() }
  } catch (e) {
    return { ok: false, offline: true, error: e instanceof Error ? e.message : 'Network error' }
  }
}
