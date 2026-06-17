/* Browse filter state + the pure predicate that applies it to the real library.
   FilterPanel/CategoryBox edit this shape (controlled); BrowseView owns it and
   runs applyFilters() over useLibrary().works. Kept JSON-serializable (arrays,
   not Sets) so a filter can later be saved verbatim to a Saved Filter. */

import type { Category, Work } from './types'

export type ChipState = 'default' | 'include' | 'exclude'
export type CatFilter = { states: Record<string, ChipState>; mode: 'OR' | 'AND' }

export type FilterState = {
  status: Record<string, ChipState> // keyed by ReadStatus
  favorite: boolean
  rating: Record<string, ChipState> // keyed by Rating
  buckets: string[] // wordcount buckets (OR)
  wordMin: string
  wordMax: string
  tags: Record<string, CatFilter> // keyed by Category
  authors: string[]
}

export const WORDCOUNT_BUCKETS = ['<10k', '10–30k', '30–80k', '80k+'] as const

/* Canonical category order for the panel (mirrors mock TAG_CATEGORIES; redesign
   §6.3.1). Any category present in the data but not listed sorts to the end. */
const CATEGORY_ORDER: Category[] = [
  'Fandom', 'Relationship', 'Character', 'Identity', 'Universe',
  'Content', 'Trope', 'Dynamics', 'Mood', 'Structure', 'Other',
]

export function emptyFilter(): FilterState {
  return { status: {}, favorite: false, rating: {}, buckets: [], wordMin: '', wordMax: '', tags: {}, authors: [] }
}

export function emptyCatFilter(): CatFilter {
  return { states: {}, mode: 'OR' }
}

/* Total active selections — drives the Filters button badge. */
export function activeCount(f: FilterState): number {
  let n = 0
  n += Object.values(f.status).filter((s) => s !== 'default').length
  n += f.favorite ? 1 : 0
  n += Object.values(f.rating).filter((s) => s !== 'default').length
  n += f.buckets.length
  n += f.wordMin.trim() || f.wordMax.trim() ? 1 : 0
  for (const cat of Object.values(f.tags)) n += Object.values(cat.states).filter((s) => s !== 'default').length
  n += f.authors.length
  return n
}

function inBucket(wc: number, b: string): boolean {
  switch (b) {
    case '<10k': return wc < 10_000
    case '10–30k': return wc >= 10_000 && wc < 30_000
    case '30–80k': return wc >= 30_000 && wc < 80_000
    case '80k+': return wc >= 80_000
    default: return true
  }
}

/* Tri-state pass for a single-valued field (status, rating): the work's value
   must be among includes (if any are set) and never among excludes. */
function singlePass(value: string, states: Record<string, ChipState>): boolean {
  const inc: string[] = []
  const exc: string[] = []
  for (const [k, s] of Object.entries(states)) {
    if (s === 'include') inc.push(k)
    else if (s === 'exclude') exc.push(k)
  }
  if (exc.includes(value)) return false
  if (inc.length && !inc.includes(value)) return false
  return true
}

export function applyFilters(works: Work[], f: FilterState): Work[] {
  const min = f.wordMin.trim() ? Number(f.wordMin) : null
  const max = f.wordMax.trim() ? Number(f.wordMax) : null
  const authorSet = f.authors.map((a) => a.toLowerCase())

  return works.filter((w) => {
    if (!singlePass(w.readStatus, f.status)) return false
    if (f.favorite && !w.isFavorite) return false
    if (!singlePass(w.rating, f.rating)) return false

    if (f.buckets.length && !f.buckets.some((b) => inBucket(w.wordcount, b))) return false
    if (min != null && !Number.isNaN(min) && w.wordcount < min) return false
    if (max != null && !Number.isNaN(max) && w.wordcount > max) return false

    if (authorSet.length) {
      const wa = w.authors.map((a) => a.toLowerCase())
      if (!authorSet.some((a) => wa.includes(a))) return false
    }

    // Tag categories: per-category OR/AND over includes, plus global exclude.
    const tagNames = new Set(w.tags.map((t) => t.name.toLowerCase()))
    for (const cat of Object.values(f.tags)) {
      const inc: string[] = []
      const exc: string[] = []
      for (const [name, s] of Object.entries(cat.states)) {
        if (s === 'include') inc.push(name.toLowerCase())
        else if (s === 'exclude') exc.push(name.toLowerCase())
      }
      if (exc.some((n) => tagNames.has(n))) return false
      if (inc.length) {
        const ok = cat.mode === 'AND' ? inc.every((n) => tagNames.has(n)) : inc.some((n) => tagNames.has(n))
        if (!ok) return false
      }
    }
    return true
  })
}

export type FacetTag = { name: string; count: number; favorite?: boolean }
export type Facet = { category: Category; tags: FacetTag[] }
export type Facets = { categories: Facet[]; authors: string[] }

/* Derive the panel's real options (tag categories + author list) from the loaded
   library, so every chip/suggestion matches an actual tag in the data. `favNames`
   (favorited tag display-names from Tag Management) marks which tags show by
   default in each Browse category box. */
export function buildFacets(works: Work[], favNames?: Set<string>): Facets {
  const byCat = new Map<Category, Map<string, number>>()
  const authors = new Map<string, number>()

  for (const w of works) {
    for (const a of w.authors) authors.set(a, (authors.get(a) ?? 0) + 1)
    for (const t of w.tags) {
      let m = byCat.get(t.category)
      if (!m) byCat.set(t.category, (m = new Map()))
      m.set(t.name, (m.get(t.name) ?? 0) + 1)
    }
  }

  const present = [...byCat.keys()]
  present.sort((a, b) => {
    const ia = CATEGORY_ORDER.indexOf(a)
    const ib = CATEGORY_ORDER.indexOf(b)
    return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib) || a.localeCompare(b)
  })

  const categories: Facet[] = present.map((category) => ({
    category,
    tags: [...byCat.get(category)!.entries()]
      .map(([name, count]) => ({ name, count, favorite: favNames?.has(name) || undefined }))
      .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
  }))

  return { categories, authors: [...authors.keys()].sort((a, b) => a.localeCompare(b)) }
}

/* ---- Dependent (faceted) filtering -------------------------------------- //
   Co-occurrence-aware live counts: each facet's options/counts are computed over
   the works matching all OTHER active constraints ("leave-one-out"), so a box never
   limits itself (OR multi-select keeps working) but every other selection — includes
   AND excludes, tag categories AND quick filters — narrows it. Pure + client-side
   over the in-memory works; recompute on each filter change.
   MUST stay in sync with applyFilters() above. (docs/ux/faceted-filtering.md) */
export type DependentFacets = {
  total: number
  tags: Map<Category, Map<string, number>>
  status: Map<string, number>
  rating: Map<string, number>
  buckets: Map<string, number>
}

export function dependentFacets(works: Work[], f: FilterState): DependentFacets {
  const prepared = works.map((w) => ({ w, names: new Set(w.tags.map((t) => t.name.toLowerCase())) }))
  const min = f.wordMin.trim() ? Number(f.wordMin) : null
  const max = f.wordMax.trim() ? Number(f.wordMax) : null
  const authorSet = f.authors.map((a) => a.toLowerCase())

  // Precompute each active tag category's include/exclude/mode once.
  const catC = new Map<string, { inc: string[]; exc: string[]; mode: 'OR' | 'AND' }>()
  for (const [cat, cf] of Object.entries(f.tags)) {
    const inc: string[] = []; const exc: string[] = []
    for (const [name, s] of Object.entries(cf.states)) {
      if (s === 'include') inc.push(name.toLowerCase())
      else if (s === 'exclude') exc.push(name.toLowerCase())
    }
    if (inc.length || exc.length) catC.set(cat, { inc, exc, mode: cf.mode })
  }
  const activeCats = [...catC.keys()]

  const passStatus = (w: Work) => singlePass(w.readStatus, f.status)
  const passFav = (w: Work) => !f.favorite || w.isFavorite
  const passRating = (w: Work) => singlePass(w.rating, f.rating)
  const passWords = (w: Work) => {
    if (f.buckets.length && !f.buckets.some((b) => inBucket(w.wordcount, b))) return false
    if (min != null && !Number.isNaN(min) && w.wordcount < min) return false
    if (max != null && !Number.isNaN(max) && w.wordcount > max) return false
    return true
  }
  const passAuthor = (w: Work) => !authorSet.length || w.authors.some((a) => authorSet.includes(a.toLowerCase()))
  const passTag = (names: Set<string>, cat: string) => {
    const c = catC.get(cat); if (!c) return true
    if (c.exc.some((n) => names.has(n))) return false
    if (c.inc.length) {
      const ok = c.mode === 'AND' ? c.inc.every((n) => names.has(n)) : c.inc.some((n) => names.has(n))
      if (!ok) return false
    }
    return true
  }
  // Passes every active facet except the one named ('' skips nothing). Favorite is
  // a binary toggle with no count facet, so it always applies.
  const matchesExcept = (p: { w: Work; names: Set<string> }, except: string) => {
    if (except !== 'status' && !passStatus(p.w)) return false
    if (!passFav(p.w)) return false
    if (except !== 'rating' && !passRating(p.w)) return false
    if (except !== 'words' && !passWords(p.w)) return false
    if (except !== 'author' && !passAuthor(p.w)) return false
    for (const cat of activeCats) { if (except === 'tag:' + cat) continue; if (!passTag(p.names, cat)) return false }
    return true
  }

  const tags = new Map<Category, Map<string, number>>()
  const status = new Map<string, number>()
  const rating = new Map<string, number>()
  const buckets = new Map<string, number>()

  const cats = new Set<Category>()
  for (const p of prepared) for (const t of p.w.tags) cats.add(t.category)
  for (const cat of cats) tags.set(cat, new Map())

  // Quick-filter counts (leave-one-out per facet) + the full match set.
  const fullMatch = prepared.filter((p) => matchesExcept(p, ''))
  for (const p of prepared) {
    if (matchesExcept(p, 'status')) status.set(p.w.readStatus, (status.get(p.w.readStatus) ?? 0) + 1)
    if (matchesExcept(p, 'rating')) rating.set(p.w.rating, (rating.get(p.w.rating) ?? 0) + 1)
    if (matchesExcept(p, 'words')) for (const b of WORDCOUNT_BUCKETS) if (inBucket(p.w.wordcount, b)) buckets.set(b, (buckets.get(b) ?? 0) + 1)
  }

  // Tag category counts: active categories get a leave-one-out pass; the rest reuse
  // the full match set (their basis is just "all active filters").
  for (const cat of cats) {
    const m = tags.get(cat)!
    const basis = catC.has(cat) ? prepared.filter((p) => matchesExcept(p, 'tag:' + cat)) : fullMatch
    for (const p of basis) for (const t of p.w.tags) if (t.category === cat) m.set(t.name, (m.get(t.name) ?? 0) + 1)
  }

  return { total: fullMatch.length, tags, status, rating, buckets }
}
