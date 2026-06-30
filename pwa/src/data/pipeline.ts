/* Import-pipeline inspector (Sync view). Lists capture/queue items that haven't
   committed — stuck/pending captures, items awaiting review, failed commits — and
   lets the user dismiss ones they want gone. Committed items are the bulk of the
   table and not actionable, so we never fetch them here (skips a ~7k-row payload). */

import { authHeaders, getHub } from './config'

export type PipelineState =
  | 'pending' | 'normalized' | 'auto_committed' | 'needs_review' | 'committed' | 'failed'

/* Everything except `committed` — the actionable / stuck states. */
const OPEN_STATES: PipelineState[] = ['pending', 'normalized', 'auto_committed', 'needs_review', 'failed']

export type PipelineItem = {
  id: string
  workId: number
  title: string
  state: PipelineState
  epubStaged: boolean
  error: string | null
  createdAt: string
}

type RawQueueItem = {
  queue_item_id: string
  work_id: number
  state: PipelineState
  error: string | null
  created_at: string
  raw_metadata: { title?: string } | null
  proposals: { epub_staged?: boolean } | null
}

function mapItem(q: RawQueueItem): PipelineItem {
  return {
    id: q.queue_item_id,
    workId: q.work_id,
    title: q.raw_metadata?.title || `(work ${q.work_id})`,
    state: q.state,
    epubStaged: q.proposals?.epub_staged === true,
    error: q.error,
    createdAt: q.created_at,
  }
}

/* Fetch the open (non-committed) pipeline. One call per state in parallel, since
   the hub's GET /api/queue filters by a single state; merged + newest-first. */
export async function fetchPipeline(): Promise<PipelineItem[]> {
  const hub = getHub()
  const results = await Promise.all(
    OPEN_STATES.map(async (state) => {
      const res = await fetch(`${hub}/api/queue?state=${state}&limit=500`, { headers: authHeaders() })
      if (!res.ok) throw new Error(`queue ${state} → ${res.status}`)
      return (await res.json()) as RawQueueItem[]
    }),
  )
  return results
    .flat()
    .map(mapItem)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
}

/* Dismiss a pipeline item (deletes only the queue row; a committed work is
   unaffected — works has no FK to queue_items). */
export async function dismissQueueItem(id: string): Promise<void> {
  const res = await fetch(`${getHub()}/api/queue/${id}`, { method: 'DELETE', headers: authHeaders() })
  if (!res.ok && res.status !== 404) throw new Error(`dismiss → ${res.status}`)
}
