/* Per-work Review Queue (pending-queue redesign). Ambiguous captures (>1 fandom or
   >1 relationship) wait in the unified `pending_changes` queue as un-approved capture
   items; here the user picks which of the work's own raw tags carries each primary
   role. Confirming approves the capture (sets primaries); the work itself commits
   later from the Pending page's "Apply to Library". No grouping/synonym/category work
   here (that's Tag Management). */

import { authHeaders, getHub } from './config'

export type ReviewCandidate = { name: string; tagId: number }

export type ReviewQueueItem = {
  queueItemId: string // the pending_changes id
  workId: number
  title: string
  authors: string[]
  rating: string | null
  wordcount: number
  summary: string
  createdAt: string
  epubStaged: boolean
  fandoms: ReviewCandidate[]
  ships: ReviewCandidate[]
  defaultFandomTagId: number | null
  defaultShipTagId: number | null
}

const stripHtml = (s: unknown): string =>
  !s ? '' : String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

type RawTag = {
  name: string
  kind: string
  position: number
  tag_id: number | null
  is_primary_ship: boolean
  is_primary_collection: boolean
}

type RawPending = {
  id: string
  work_id: number
  action: string
  title: string | null
  author: string | null
  created_at: string
  payload: {
    raw_metadata?: { title?: string; authors?: string[]; wordcount?: number; summary_html?: string }
    proposals?: { tags?: RawTag[]; rating?: string | null; approved?: boolean; epub_staged?: boolean }
  } | null
}

function mapItem(p: RawPending): ReviewQueueItem {
  const raw = p.payload?.raw_metadata || {}
  const prop = p.payload?.proposals || {}
  const tags = prop.tags || []
  const byKind = (k: string): ReviewCandidate[] =>
    tags
      .filter((t) => t.kind === k && t.tag_id != null)
      .sort((a, b) => (a.position ?? 0) - (b.position ?? 0))
      .map((t) => ({ name: t.name, tagId: t.tag_id as number }))
  return {
    queueItemId: p.id,
    workId: p.work_id,
    title: p.title || raw.title || `(work ${p.work_id})`,
    authors: raw.authors || (p.author ? [p.author] : []),
    rating: prop.rating ?? null,
    wordcount: raw.wordcount ?? 0,
    summary: stripHtml(raw.summary_html),
    createdAt: p.created_at,
    epubStaged: prop.epub_staged === true,
    fandoms: byKind('fandom'),
    ships: byKind('relationship'),
    defaultFandomTagId: tags.find((t) => t.is_primary_collection)?.tag_id ?? null,
    defaultShipTagId: tags.find((t) => t.is_primary_ship)?.tag_id ?? null,
  }
}

/* Capture items still awaiting a primary decision (un-approved). Unambiguous
   captures are auto-approved at queue time and skip this surface entirely. */
export async function fetchReviewQueue(): Promise<ReviewQueueItem[]> {
  const res = await fetch(`${getHub()}/api/pending`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`pending → ${res.status}`)
  const items: RawPending[] = await res.json()
  const review = items.filter((p) => p.action === 'capture' && p.payload?.proposals?.approved === false)
  const byWork = new Map<number, ReviewQueueItem>()
  for (const it of review.map(mapItem)) {
    const prev = byWork.get(it.workId)
    if (!prev || it.createdAt > prev.createdAt) byWork.set(it.workId, it)
  }
  return [...byWork.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
}

export async function fetchReviewCount(): Promise<number> {
  return (await fetchReviewQueue()).length
}

/* Approve the capture with the chosen primaries. tagId null clears the axis (gen
   ship / no collection). The work commits later from the Pending page. */
export async function submitReview(
  pendingId: string,
  primaryCollectionTagId: number | null,
  primaryShipTagId: number | null,
): Promise<void> {
  const res = await fetch(`${getHub()}/api/pending/${pendingId}/review`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({
      primary_collection_tag_id: primaryCollectionTagId,
      primary_ship_tag_id: primaryShipTagId,
    }),
  })
  if (!res.ok) throw new Error(`review → ${res.status} ${await res.text().catch(() => '')}`.trim())
}
