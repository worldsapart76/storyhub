/* Tag Management data (redesign §6.3 / §12.6). Tags are read live from the hub
   (so edits show immediately); per-tag use counts and group membership come from
   the snapshot's relational tables (work_tags, tag_groups, tag_group_members).
   Sub-chunk 1 edits alias/category/state; synonyms + groups are read-only here. */

import type { Database } from 'sql.js'
import { authHeaders, getHub } from './config'

export type TagKind = 'fandom' | 'relationship' | 'character' | 'freeform' | 'warning'
export type TagState = 'favorite' | 'normal' | 'excluded'

export type ManagedTag = {
  id: number
  name: string
  displayName: string | null
  kind: TagKind
  category: string | null
  state: TagState
  autoClassified: boolean
  canonicalTagId: number | null
}

function toTag(r: any): ManagedTag {
  return {
    id: r.tag_id, name: r.name, displayName: r.display_name ?? null, kind: r.kind,
    category: r.category ?? null, state: r.state, autoClassified: !!r.auto_classified,
    canonicalTagId: r.canonical_tag_id ?? null,
  }
}

async function req(path: string, init?: RequestInit): Promise<any> {
  const res = await fetch(`${getHub()}/api${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.status === 204 ? null : res.json()
}

export const fetchTags = () => req('/tags?limit=20000').then((rows) => (rows as any[]).map(toTag))

export type TagPatch = Partial<{
  display_name: string | null; category: string | null; state: TagState
  auto_classified: boolean; canonical_tag_id: number | null
}>

export const patchTag = (id: number, patch: TagPatch) =>
  req(`/tags/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(toTag)

/* Favorited tag display-names, for seeding the Browse filter category boxes. */
export async function fetchFavoriteTagNames(): Promise<Set<string>> {
  try {
    const rows = await req('/tags?state=favorite&limit=20000')
    return new Set((rows as any[]).map((t) => (t.display_name || t.name) as string))
  } catch { return new Set() }
}

/* Per-tag use counts from the snapshot's work_tags table. */
export function readTagCounts(db: Database | null): Map<number, number> {
  const m = new Map<number, number>()
  if (!db) return m
  try {
    const res = db.exec('SELECT tag_id, COUNT(*) AS c FROM work_tags GROUP BY tag_id')
    if (res.length) for (const [id, c] of res[0].values) m.set(Number(id), Number(c))
  } catch { /* table absent */ }
  return m
}

/* ---- Synonyms + roll-up groups (sub-chunk 2, live) ----
   Synonym equivalence is tags.canonical_tag_id ([RESOLVED #1]); a tag with a
   canonical is a synonym OF it. Two tags may be synonyms only within the same
   "domain" (the category if set, else the kind — §6.3.1 refinement). Roll-up
   groups (/api/groups) are collection|property; a group's class is inferred
   from member kind: structural kinds → collection, descriptive → property. */
export type GroupClass = 'collection' | 'property'

export const groupClassOf = (k: TagKind): GroupClass =>
  k === 'fandom' || k === 'relationship' ? 'collection' : 'property'

export const synonymDomainOf = (t: { category: string | null; kind: TagKind }): string =>
  t.category ?? `kind:${t.kind}`

export type TagGroup = {
  id: number
  name: string
  groupType: GroupClass
  canonicalTagId: number | null
  memberTagIds: number[]
}

function toGroup(r: any): TagGroup {
  return {
    id: r.group_id, name: r.name, groupType: r.group_type,
    canonicalTagId: r.canonical_tag_id ?? null, memberTagIds: (r.member_tag_ids as number[]) ?? [],
  }
}

export const fetchGroups = () => req('/groups').then((rows) => (rows as any[]).map(toGroup))

export const createGroup = (name: string, groupType: GroupClass, memberTagIds: number[]) =>
  req('/groups', { method: 'POST', body: JSON.stringify({ name, group_type: groupType, member_tag_ids: memberTagIds }) }).then(toGroup)

export const addGroupMember = (groupId: number, tagId: number) =>
  req(`/groups/${groupId}/members/${tagId}`, { method: 'POST' }).then(toGroup)

export const removeGroupMember = (groupId: number, tagId: number) =>
  req(`/groups/${groupId}/members/${tagId}`, { method: 'DELETE' }).then(toGroup)

export const deleteGroup = (groupId: number) => req(`/groups/${groupId}`, { method: 'DELETE' })

export type GroupRef = { name: string; cls: 'collection' | 'property' }

/* Per-tag group memberships from the snapshot (read-only display for now). */
export function readTagGroups(db: Database | null): Map<number, GroupRef[]> {
  const m = new Map<number, GroupRef[]>()
  if (!db) return m
  try {
    const res = db.exec(
      'SELECT m.tag_id, g.name, g.group_type FROM tag_group_members m ' +
      'JOIN tag_groups g ON g.group_id = m.group_id')
    if (res.length) for (const [tagId, name, cls] of res[0].values) {
      const arr = m.get(Number(tagId)) ?? []
      arr.push({ name: String(name), cls: cls as GroupRef['cls'] })
      m.set(Number(tagId), arr)
    }
  } catch { /* tables absent */ }
  return m
}
