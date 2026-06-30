/* Edit a committed work's primary ship / primary collection (the per-work decision
   the Review Queue makes at capture — here for works already in the library). The
   candidate ships/fandoms (with tag ids) and the optimistic display strings all come
   from the snapshot already in IndexedDB; the write goes to the hub and takes effect
   in Browse on the next snapshot rebuild. */

import type { Database } from 'sql.js'
import { authHeaders, getHub } from './config'

export type PrimaryCandidate = { tagId: number; name: string }
export type PrimaryInfo = {
  ships: PrimaryCandidate[]
  fandoms: PrimaryCandidate[]
  currentShipTagId: number | null
  currentCollectionTagId: number | null
}

const EMPTY: PrimaryInfo = { ships: [], fandoms: [], currentShipTagId: null, currentCollectionTagId: null }

/* The work's own relationship + fandom tags (with ids) and which currently carry the
   primary flags — read from the snapshot's work_tags ⨝ tags. */
export function readPrimaryInfo(db: Database | null, workId: number): PrimaryInfo {
  if (!db || !Number.isFinite(workId)) return EMPTY
  try {
    const res = db.exec(
      'SELECT wt.tag_id, COALESCE(t.display_name, t.name) AS name, t.kind, ' +
      'wt.is_primary_ship, wt.is_primary_collection ' +
      'FROM work_tags wt JOIN tags t ON t.tag_id = wt.tag_id ' +
      `WHERE wt.work_id = ${workId} ORDER BY wt.position`)
    if (!res.length) return EMPTY
    const ships: PrimaryCandidate[] = []
    const fandoms: PrimaryCandidate[] = []
    let currentShipTagId: number | null = null
    let currentCollectionTagId: number | null = null
    for (const [tagId, name, kind, isShip, isColl] of res[0].values) {
      const c = { tagId: Number(tagId), name: String(name) }
      if (kind === 'relationship') ships.push(c)
      else if (kind === 'fandom') fandoms.push(c)
      if (isShip) currentShipTagId = Number(tagId)
      if (isColl) currentCollectionTagId = Number(tagId)
    }
    return { ships, fandoms, currentShipTagId, currentCollectionTagId }
  } catch { return EMPTY }
}

/* A tag's display name, resolving a synonym to its canonical (what the snapshot
   projects). Used for the optimistic primary-ship label. */
export function resolveDisplay(db: Database | null, tagId: number | null): string | null {
  if (!db || tagId == null) return null
  try {
    const res = db.exec(
      'SELECT t.name, t.display_name, c.name AS cname, c.display_name AS cdisp ' +
      'FROM tags t LEFT JOIN tags c ON c.tag_id = t.canonical_tag_id ' +
      `WHERE t.tag_id = ${tagId}`)
    if (!res.length || !res[0].values.length) return null
    const [name, disp, cname, cdisp] = res[0].values[0]
    if (cname != null) return String(cdisp || cname)
    return String(disp || name)
  } catch { return null }
}

/* The collection LABEL a primary-collection fandom projects to: its collection
   group's name if it belongs to one, else the fandom's own display name (mirrors
   snapshot_builder `coll_of.get(tag_id) or name`). */
export function collectionDisplay(db: Database | null, fandomTagId: number | null): string | null {
  if (!db || fandomTagId == null) return null
  try {
    const res = db.exec(
      'SELECT g.name FROM tag_group_members m JOIN tag_groups g ON g.group_id = m.group_id ' +
      `WHERE m.tag_id = ${fandomTagId} AND g.group_type = 'collection' LIMIT 1`)
    if (res.length && res[0].values.length) return String(res[0].values[0][0])
  } catch { /* fall through to the fandom name */ }
  return resolveDisplay(db, fandomTagId)
}

export async function setPrimaries(
  workId: number, shipTagId: number | null, collectionTagId: number | null,
): Promise<void> {
  const res = await fetch(`${getHub()}/api/works/${workId}/primaries`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ primary_ship_tag_id: shipTagId, primary_collection_tag_id: collectionTagId }),
  })
  if (!res.ok) throw new Error(`primaries → ${res.status} ${await res.text().catch(() => '')}`.trim())
}
