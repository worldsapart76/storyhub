/* Reading Lists + Saved Filters: live API read/write (not via the snapshot, so
   creates/edits show immediately). Camel/snake mapping lives here. */

import { authHeaders, getHub } from './config'
import { activeCount, emptyFilter, type FilterState } from './filters'

export type SavedFilterRow = {
  id: string
  name: string
  filterState: FilterState | null
  sort: string | null
  starred: boolean
}

export type ReadingListRow = {
  id: string
  name: string
  description: string | null
  color: string | null
  autoPin: boolean
  isSystem: boolean
  starred: boolean
  memberIds: number[]
}

async function req(path: string, init?: RequestInit): Promise<unknown> {
  const res = await fetch(`${getHub()}/api${path}`, {
    ...init,
    headers: { ...authHeaders(), ...(init?.body ? { 'Content-Type': 'application/json' } : {}) },
  })
  if (!res.ok) throw new Error(`${res.status} ${await res.text().catch(() => '')}`.trim())
  return res.status === 204 ? null : res.json()
}

/* ---- Saved Filters ---- */

function toFilterRow(r: any): SavedFilterRow {
  // Merge over emptyFilter so a partial/legacy stored state can't crash filtering.
  const stored = r.filter_state_json
  return {
    id: r.id,
    name: r.name,
    filterState: stored ? { ...emptyFilter(), ...stored } : null,
    sort: r.sort_state_json?.label ?? null,
    starred: !!r.starred,
  }
}

export const fetchSavedFilters = () =>
  req('/saved-filters').then((rows) => (rows as any[]).map(toFilterRow))

export const createSavedFilter = (name: string, filterState: FilterState, sort: string, starred: boolean) =>
  req('/saved-filters', {
    method: 'POST',
    body: JSON.stringify({ name, filter_state_json: filterState, sort_state_json: { label: sort }, starred }),
  }).then(toFilterRow)

export const patchSavedFilter = (id: string, patch: { name?: string; starred?: boolean; filter_state_json?: FilterState; sort_state_json?: { label: string } }) =>
  req(`/saved-filters/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(toFilterRow)

export const deleteSavedFilter = (id: string) => req(`/saved-filters/${id}`, { method: 'DELETE' })

/* ---- Reading Lists ---- */

function toListRow(r: any): ReadingListRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description ?? null,
    color: r.color ?? null,
    autoPin: !!r.auto_pin,
    isSystem: !!r.is_system,
    starred: !!r.starred,
    memberIds: (r.member_ids as number[]) ?? [],
  }
}

export const fetchReadingLists = () =>
  req('/reading-lists').then((rows) => (rows as any[]).map(toListRow))

export const createReadingList = (p: { name: string; description?: string | null; color?: string | null; starred?: boolean }) =>
  req('/reading-lists', {
    method: 'POST',
    body: JSON.stringify({ name: p.name, description: p.description ?? null, color: p.color ?? null, starred: !!p.starred }),
  }).then(toListRow)

export const patchReadingList = (id: string, patch: { name?: string; description?: string | null; color?: string | null; auto_pin?: boolean; starred?: boolean }) =>
  req(`/reading-lists/${id}`, { method: 'PATCH', body: JSON.stringify(patch) }).then(toListRow)

export const deleteReadingList = (id: string) => req(`/reading-lists/${id}`, { method: 'DELETE' })

export const addListMembers = (id: string, workIds: number[]) =>
  req(`/reading-lists/${id}/members`, { method: 'POST', body: JSON.stringify({ work_ids: workIds }) }).then(toListRow)

export const removeListMembers = (id: string, workIds: number[]) =>
  req(`/reading-lists/${id}/members/remove`, { method: 'POST', body: JSON.stringify({ work_ids: workIds }) }).then(toListRow)

export const reorderListMembers = (id: string, workIds: number[]) =>
  req(`/reading-lists/${id}/order`, { method: 'PUT', body: JSON.stringify({ work_ids: workIds }) }).then(toListRow)

/* ---- Filter summary chips (for the Saved Filters surface) ---- */

export type FilterChipSummary = { label: string; kind: 'include' | 'exclude' | 'meta' }

export function summarizeFilter(fs: FilterState | null): FilterChipSummary[] {
  if (!fs) return []
  const out: FilterChipSummary[] = []
  for (const [k, v] of Object.entries(fs.status)) if (v !== 'default') out.push({ label: k, kind: v as any })
  if (fs.favorite) out.push({ label: '★ Favorite', kind: 'meta' })
  for (const [k, v] of Object.entries(fs.rating)) if (v !== 'default') out.push({ label: k, kind: v as any })
  for (const b of fs.buckets) out.push({ label: b, kind: 'meta' })
  if (fs.wordMin || fs.wordMax) out.push({ label: `${fs.wordMin || '0'}–${fs.wordMax || '∞'} words`, kind: 'meta' })
  for (const cat of Object.values(fs.tags))
    for (const [name, v] of Object.entries(cat.states)) if (v !== 'default') out.push({ label: name, kind: v as any })
  for (const a of fs.authors) out.push({ label: `by ${a}`, kind: 'meta' })
  return out
}

export const filterIsEmpty = (fs: FilterState | null) => !fs || activeCount(fs) === 0
