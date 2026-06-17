import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import './TagManagement.css'
import { useLibrary } from '../data/library'
import {
  fetchTags, patchTag, readTagCounts,
  fetchGroups, createGroup, addGroupMember, removeGroupMember, deleteGroup,
  groupClassOf, canBeSynonymOf,
  type ManagedTag, type TagKind, type TagState, type TagGroup,
} from '../data/tags'
import {
  fetchCategories, createCategory, renameCategory, deleteCategory,
  reorderCategories, setCategoryLock, type Category,
} from '../data/categories'
import { markSnapshotDirty, isSnapshotDirty, onSnapshotDirtyChange, rebuildSnapshot } from '../data/snapshot'
import { useNav } from '../data/appnav'
import { emptyFilter } from '../data/filters'

/* Tag Management (redesign §12.6). Sub-chunk 1: editable display alias, category,
   and state (★ favorite / normal / excluded), with per-tag use counts. Sub-chunk 2:
   live-editable synonyms (canonical_tag_id) + roll-up groups (/api/groups).
   Sub-chunk 3 (this): the Categories tab — the freeform category SET + global lock
   (/api/categories). Everything reads live from the hub so edits show immediately.
   Favoriting a tag here surfaces it in the Browse filter boxes. */

const KINDS: TagKind[] = ['fandom', 'relationship', 'character', 'freeform', 'warning']
const KIND_ABBR: Record<TagKind, string> = {
  fandom: 'Fandom', relationship: 'Ship', character: 'Char', freeform: 'Freeform', warning: 'Warning',
}
const CLASS_MARK = { collection: '▣', property: '◆' } as const
const categoryAllowed = (k: TagKind) => k === 'freeform' || k === 'warning'

// Per-row state cycles on a single click: Normal → Favorite → Excluded → Normal.
// A tag's Browse filter category box — MUST mirror snapshot_builder._card_category
// so the "open in Browse" hand-off includes the tag under the box it lands in.
function browseCategory(t: { kind: TagKind; category: string | null }): string {
  if (t.kind === 'fandom') return 'Fandom'
  if (t.kind === 'relationship') return 'Relationship'
  if (t.kind === 'character') return 'Character'
  if (t.kind === 'warning') return t.category ?? 'Content'
  return t.category ?? 'Other'
}

const NEXT_STATE: Record<TagState, TagState> = { normal: 'favorite', favorite: 'excluded', excluded: 'normal' }
const STATE_ICON: Record<TagState, string> = { normal: '☆', favorite: '★', excluded: '⊘' }
const STATE_TITLE: Record<TagState, string> = {
  normal: 'Normal — click to Favorite',
  favorite: 'Favorite — click to Exclude',
  excluded: 'Excluded (hidden from filters) — click to reset to Normal',
}

type TabProps = { tab: 'tags' | 'categories'; setTab: (t: 'tags' | 'categories') => void }

/* Title + tab switch. Lives inside each view's sticky toolbar (not the wrapper) so
   the whole top region — header, filters, bulk bar, column labels — pins as one
   block while the rows scroll under it. */
function TmHeader({ tab, setTab }: TabProps) {
  return (
    <header className="tm__head">
      <h1 className="tm__title">Tags</h1>
      <div className="tm__headright">
        <RebuildButton />
        <div className="tm__tabs" role="tablist">
          <button className={'tm__tab' + (tab === 'tags' ? ' is-on' : '')} role="tab" aria-selected={tab === 'tags'} onClick={() => setTab('tags')}>Tags</button>
          <button className={'tm__tab' + (tab === 'categories' ? ' is-on' : '')} role="tab" aria-selected={tab === 'categories'} onClick={() => setTab('categories')}>Categories</button>
        </div>
      </div>
    </header>
  )
}

/* Applies pending curation to Browse by rebuilding the snapshot, then reloading
   the library so the new version is fetched. Shows a pending dot when curation
   edits are waiting (so a rebuild is never forgotten). */
function RebuildButton() {
  const { reload } = useLibrary()
  const [dirty, setDirty] = useState(isSnapshotDirty())
  const [busy, setBusy] = useState(false)
  useEffect(() => onSnapshotDirtyChange(() => setDirty(isSnapshotDirty())), [])

  const run = () => {
    setBusy(true)
    rebuildSnapshot().then(() => reload()).catch((e) => alert(`Rebuild failed: ${e instanceof Error ? e.message : e}`)).finally(() => setBusy(false))
  }
  return (
    <button className={'tm__rebuild' + (dirty ? ' is-dirty' : '')} onClick={run} disabled={busy || !dirty}
      title={dirty ? 'Apply tag/category changes to Browse (rebuild snapshot)' : 'Browse is up to date with your curation'}>
      {busy ? 'Rebuilding…' : dirty ? '● Apply changes' : 'Up to date'}
    </button>
  )
}

export function TagManagement() {
  const [tab, setTab] = useState<'tags' | 'categories'>('tags')
  return (
    <div className="tm">
      {tab === 'tags' ? <TagsView tab={tab} setTab={setTab} /> : <CategoriesView tab={tab} setTab={setTab} />}
    </div>
  )
}

/* Searchable, alphabetised dropdown shared by the synonym + group pickers. */
type Opt = { key: string; label: string; mark?: string }
function SearchMenu({
  options, onPick, onClose, placeholder, onCreate, createNoun,
}: {
  options: Opt[]
  onPick: (key: string) => void
  onClose: () => void
  placeholder?: string
  onCreate?: (name: string) => void
  createNoun?: string
}) {
  const [q, setQ] = useState('')
  const ql = q.trim().toLowerCase()
  const matched = options.filter((o) => o.label.toLowerCase().includes(ql)).sort((a, b) => a.label.localeCompare(b.label))
  const filtered = matched.slice(0, 60)  // cap render; keep typing to narrow (scales to 28k tags)
  const more = matched.length - filtered.length
  const exact = options.some((o) => o.label.toLowerCase() === ql)
  return (
    <>
      <div className="tm__scrim" onClick={onClose} />
      <div className="tm__menu">
        <input className="tm__menusearch" autoFocus placeholder={placeholder ?? 'Filter…'} value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onCreate && q.trim() && !exact) onCreate(q.trim()) }} />
        <ul className="tm__optlist">
          {filtered.length === 0 && !onCreate && <li className="tm__menuempty">no matches</li>}
          {filtered.map((o) => (
            <li key={o.key}>
              <button className="tm__menuitem" onClick={() => onPick(o.key)}>
                {o.mark && <span className="tm__grpmark" aria-hidden>{o.mark}</span>}{o.label}
              </button>
            </li>
          ))}
          {more > 0 && <li className="tm__menuempty">+{more} more — keep typing</li>}
        </ul>
        {onCreate && q.trim() && !exact && (
          <button className="tm__create" onClick={() => onCreate(q.trim())}>+ Create {createNoun} “{q.trim()}”</button>
        )}
      </div>
    </>
  )
}

function TagsView({ tab, setTab }: TabProps) {
  const { db } = useLibrary()
  const { applyFilterToBrowse } = useNav()
  const [tags, setTags] = useState<ManagedTag[]>([])
  const [groups, setGroups] = useState<TagGroup[]>([])
  const [categories, setCategories] = useState<Category[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const tagsRef = useRef<ManagedTag[]>([])
  tagsRef.current = tags

  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<TagKind | 'all'>('all')
  const [cat, setCat] = useState<string | 'all'>('all')
  const [state, setState] = useState<TagState | 'all'>('all')
  const [quick, setQuick] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sort, setSort] = useState<{ key: 'name' | 'count'; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [synRow, setSynRow] = useState<number | null>(null)
  const [groupRow, setGroupRow] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([fetchTags(), fetchGroups(), fetchCategories()])
      .then(([ts, gs, cl]) => { setTags(ts); setGroups(gs); setCategories(cl.categories) })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const counts = useMemo(() => readTagCounts(db), [db])
  const byId = useMemo(() => new Map(tags.map((t) => [t.id, t])), [tags])
  const groupsByTag = useMemo(() => {
    const m = new Map<number, TagGroup[]>()
    for (const g of groups) for (const tid of g.memberTagIds) { const a = m.get(tid) ?? []; a.push(g); m.set(tid, a) }
    return m
  }, [groups])
  // synCounts: how many tags name this one as their canonical (= it's a canonical).
  const synCounts = useMemo(() => {
    const m = new Map<number, number>()
    for (const t of tags) if (t.canonicalTagId) m.set(t.canonicalTagId, (m.get(t.canonicalTagId) ?? 0) + 1)
    return m
  }, [tags])
  // Dropdown options are the live category set (FK-valid names), in display order.
  const cats = useMemo(() => categories.map((c) => c.name), [categories])
  const countOf = (t: ManagedTag) => counts.get(t.id) ?? 0
  const canonName = (id: number) => { const c = byId.get(id); return c ? (c.displayName ?? c.name) : '?' }
  const synCountOf = (t: ManagedTag) => synCounts.get(t.id) ?? 0

  // Open Browse filtered to this tag. Synonyms resolve to their canonical (what the
  // snapshot projects works under), and the box must match _card_category.
  const openInBrowse = (t: ManagedTag) => {
    const target = t.canonicalTagId ? (byId.get(t.canonicalTagId) ?? t) : t
    const name = target.displayName ?? target.name
    applyFilterToBrowse({ ...emptyFilter(), tags: { [browseCategory(target)]: { states: { [name]: 'include' }, mode: 'OR' } } })
  }

  const filtered = useMemo(() => tags.filter((t) => {
    const q = search.trim().toLowerCase()
    if (q && !(t.name.toLowerCase().includes(q) || (t.displayName ?? '').toLowerCase().includes(q))) return false
    if (kind !== 'all' && t.kind !== kind) return false
    if (cat !== 'all' && t.category !== cat) return false
    if (state !== 'all' && t.state !== state) return false
    if (quick.has('uncat') && !(t.category === null && categoryAllowed(t.kind))) return false
    if (quick.has('auto') && !t.autoClassified) return false
    if (quick.has('ungrouped') && ((groupsByTag.get(t.id)?.length ?? 0) > 0 || !!t.canonicalTagId)) return false
    return true
  }), [tags, search, kind, cat, state, quick, groupsByTag])

  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const d = sort.key === 'name' ? a.name.localeCompare(b.name) : countOf(a) - countOf(b)
      return sort.dir === 'asc' ? d : -d
    })
    return arr
  }, [filtered, sort, counts])

  // Row virtualization against the app shell's scroll container. The sticky
  // toolbar/thead live in that same scroller, so columns stay aligned (the
  // scrollbar narrows header and rows equally) and only the visible window
  // renders — scales to the full ~31k-tag corpus. Heights are measured so the
  // narrow card layout (taller rows) works too.
  const listRef = useRef<HTMLDivElement>(null)
  const rowV = useVirtualizer({
    count: sorted.length,
    getScrollElement: () => (listRef.current?.closest('.shell__content') as HTMLElement | null) ?? null,
    estimateSize: () => 46,
    overscan: 10,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  })

  // --- tag edits (optimistic + rollback) ---
  const edit = (id: number, patch: Partial<ManagedTag>, api: Parameters<typeof patchTag>[1]) => {
    const before = tagsRef.current.find((t) => t.id === id)
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    patchTag(id, api).then(() => markSnapshotDirty()).catch((e) => {
      if (before) setTags((prev) => prev.map((t) => (t.id === before.id ? before : t)))
      alert(`Save failed: ${e instanceof Error ? e.message : e}`)
    })
  }
  const bulk = (patch: Partial<ManagedTag>, api: Parameters<typeof patchTag>[1], guard?: (t: ManagedTag) => boolean) => {
    const ids = tags.filter((t) => selected.has(t.id) && (!guard || guard(t))).map((t) => t.id)
    if (!ids.length) return
    setTags((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, ...patch } : t)))
    Promise.all(ids.map((id) => patchTag(id, api))).then(() => markSnapshotDirty()).catch((e) => {
      alert(`Some changes failed: ${e instanceof Error ? e.message : e}`)
      fetchTags().then(setTags).catch(() => {})
    })
  }

  // --- synonym edits: set/clear canonical_tag_id (optimistic + rollback) ---
  const setSynonym = (id: number, canonicalId: number | null) => {
    const before = tagsRef.current.find((t) => t.id === id)
    setTags((prev) => prev.map((t) => (t.id === id ? { ...t, canonicalTagId: canonicalId } : t)))
    setSynRow(null)
    patchTag(id, { canonical_tag_id: canonicalId }).then(() => markSnapshotDirty()).catch((e) => {
      if (before) setTags((prev) => prev.map((t) => (t.id === before.id ? before : t)))
      alert(`Save failed: ${e instanceof Error ? e.message : e}`)
    })
  }

  // --- group edits: live (optimistic, refetch on error) ---
  const refreshGroups = () => fetchGroups().then(setGroups).catch(() => {})
  const addToGroup = (groupId: number, tagId: number) => {
    setGroups((prev) => prev.map((g) => (g.id === groupId && !g.memberTagIds.includes(tagId) ? { ...g, memberTagIds: [...g.memberTagIds, tagId] } : g)))
    setGroupRow(null)
    addGroupMember(groupId, tagId).then((g) => { setGroups((prev) => prev.map((x) => (x.id === g.id ? g : x))); markSnapshotDirty() }).catch((e) => { alert(`Save failed: ${e instanceof Error ? e.message : e}`); refreshGroups() })
  }
  const removeFromGroup = (groupId: number, tagId: number) => {
    const g = groups.find((x) => x.id === groupId)
    const last = !!g && g.memberTagIds.length <= 1
    setGroups((prev) => last ? prev.filter((x) => x.id !== groupId) : prev.map((x) => (x.id === groupId ? { ...x, memberTagIds: x.memberTagIds.filter((m) => m !== tagId) } : x)))
    const p = last ? deleteGroup(groupId) : removeGroupMember(groupId, tagId).then((gr) => setGroups((prev) => prev.map((x) => (x.id === gr.id ? gr : x))))
    p.then(() => markSnapshotDirty()).catch((e) => { alert(`Save failed: ${e instanceof Error ? e.message : e}`); refreshGroups() })
  }
  const createGroupFor = (tagId: number, name: string) => {
    const t = byId.get(tagId); if (!t) return
    setGroupRow(null)
    createGroup(name, groupClassOf(t.kind), [tagId]).then((g) => { setGroups((prev) => [...prev, g]); markSnapshotDirty() }).catch((e) => { alert(`Save failed: ${e instanceof Error ? e.message : e}`) })
  }

  // --- bulk synonym/group over the current selection ---
  const selTags = () => tags.filter((t) => selected.has(t.id))
  const bulkSynonym = (canonicalId: number) => {
    const canon = byId.get(canonicalId); if (!canon) return
    // only selected tags that may be syn'd to the canonical, aren't it, and aren't themselves canonicals
    const ids = selTags().filter((t) => t.id !== canonicalId && canBeSynonymOf(t, canon) && synCountOf(t) === 0).map((t) => t.id)
    if (!ids.length) { alert('No selected tags can be synonyms of that canonical.'); return }
    setTags((prev) => prev.map((t) => (ids.includes(t.id) ? { ...t, canonicalTagId: canonicalId } : t)))
    Promise.all(ids.map((id) => patchTag(id, { canonical_tag_id: canonicalId }))).then(() => markSnapshotDirty())
      .catch((e) => { alert(`Some changes failed: ${e instanceof Error ? e.message : e}`); fetchTags().then(setTags).catch(() => {}) })
  }
  const bulkAddGroup = (groupId: number) => {
    const g = groups.find((x) => x.id === groupId); if (!g) return
    const ids = selTags().filter((t) => groupClassOf(t.kind) === g.groupType && !g.memberTagIds.includes(t.id)).map((t) => t.id)
    if (!ids.length) { alert(`No selected tags fit this ${g.groupType} group.`); return }
    setGroups((prev) => prev.map((x) => (x.id === groupId ? { ...x, memberTagIds: [...x.memberTagIds, ...ids] } : x)))
    Promise.all(ids.map((id) => addGroupMember(groupId, id))).then(() => { markSnapshotDirty(); refreshGroups() })
      .catch((e) => { alert(`Some changes failed: ${e instanceof Error ? e.message : e}`); refreshGroups() })
  }
  const bulkRemoveGroup = (groupId: number) => {
    const ids = selTags().map((t) => t.id)
    setGroups((prev) => prev.map((x) => (x.id === groupId ? { ...x, memberTagIds: x.memberTagIds.filter((m) => !ids.includes(m)) } : x)))
    Promise.all(ids.map((id) => removeGroupMember(groupId, id).catch(() => {}))).then(() => { markSnapshotDirty(); refreshGroups() })
  }
  const bulkCreateGroup = (name: string) => {
    const sel = selTags(); if (!sel.length) return
    const cls = groupClassOf(sel[0].kind)  // group's class from the first selected; only same-class tags join
    const ids = sel.filter((t) => groupClassOf(t.kind) === cls).map((t) => t.id)
    createGroup(name, cls, ids).then((g) => { setGroups((prev) => [...prev, g]); markSnapshotDirty() })
      .catch((e) => { alert(`Save failed: ${e instanceof Error ? e.message : e}`) })
  }

  // option builders for the per-row pickers
  const synOptions = (t: ManagedTag): Opt[] => {
    const opts: Opt[] = t.canonicalTagId ? [{ key: '', label: '— not a synonym —' }] : []
    for (const c of tags) {
      if (c.id === t.id || c.canonicalTagId != null) continue // no self, no chains
      if (!canBeSynonymOf(t, c)) continue
      opts.push({ key: String(c.id), label: c.displayName ?? c.name })
    }
    return opts
  }
  const groupOptions = (t: ManagedTag): Opt[] => {
    const cls = groupClassOf(t.kind)
    const mine = new Set((groupsByTag.get(t.id) ?? []).map((g) => g.id))
    return groups.filter((g) => g.groupType === cls && !mine.has(g.id)).map((g) => ({ key: String(g.id), label: g.name, mark: CLASS_MARK[g.groupType] }))
  }

  const toggleQuick = (q: string) => setQuick((p) => { const n = new Set(p); n.has(q) ? n.delete(q) : n.add(q); return n })
  const toggleSel = (id: number) => setSelected((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id)))
  const toggleSort = (key: 'name' | 'count') =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'count' ? 'desc' : 'asc' }))
  const arrow = (key: 'name' | 'count') => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')

  // bulk picker options
  const bulkSynCands = useMemo<Opt[]>(() => tags.filter((t) => t.canonicalTagId == null)
    .map((t) => ({ key: String(t.id), label: t.displayName ?? t.name })), [tags])
  const bulkGroupAdd = useMemo<Opt[]>(() => groups.map((g) => ({ key: String(g.id), label: g.name, mark: CLASS_MARK[g.groupType] })), [groups])
  const bulkGroupRemove = useMemo<Opt[]>(() => groups.filter((g) => g.memberTagIds.some((m) => selected.has(m)))
    .map((g) => ({ key: String(g.id), label: g.name, mark: CLASS_MARK[g.groupType] })), [groups, selected])

  if (loading) return <><div className="tm__sticky"><TmHeader tab={tab} setTab={setTab} /></div><p style={pad}>Loading…</p></>
  if (error) return <><div className="tm__sticky"><TmHeader tab={tab} setTab={setTab} /></div><p style={pad}>Couldn’t load: {error}</p></>

  return (
    <>
      <div className="tm__sticky">
      <TmHeader tab={tab} setTab={setTab} />
      <div className="tm__filters">
        <input className="tm__search" placeholder="Search tags…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="tm__select" value={kind} onChange={(e) => setKind(e.target.value as TagKind | 'all')}>
          <option value="all">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_ABBR[k]}</option>)}
        </select>
        <select className="tm__select" value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="all">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select className="tm__select" value={state} onChange={(e) => setState(e.target.value as TagState | 'all')}>
          <option value="all">Any state</option>
          <option value="favorite">Favorite</option>
          <option value="normal">Normal</option>
          <option value="excluded">Excluded</option>
        </select>
        <div className="tm__quick">
          <button className={'tm__chip' + (quick.has('uncat') ? ' is-on' : '')} onClick={() => toggleQuick('uncat')}>Uncategorized</button>
          <button className={'tm__chip' + (quick.has('ungrouped') ? ' is-on' : '')} onClick={() => toggleQuick('ungrouped')}>Ungrouped</button>
          <button className={'tm__chip' + (quick.has('auto') ? ' is-on' : '')} onClick={() => toggleQuick('auto')}>Needs review</button>
        </div>
      </div>

      <div className="tm__count">{filtered.length} of {tags.length} tags</div>

      {selected.size > 0 && (
        <div className="tm__bulk" role="toolbar" aria-label="Bulk tag actions">
          <span className="tm__bulkcount">{selected.size} selected</span>
          <div className="tm__bulkactions">
            <div className="tm__bulkgroup">
              <button className="tm__bulkbtn" onClick={() => bulk({ state: 'favorite' }, { state: 'favorite' })}>★ Favorite</button>
              <button className="tm__bulkbtn" onClick={() => bulk({ state: 'normal' }, { state: 'normal' })}>Normal</button>
              <button className="tm__bulkbtn" onClick={() => bulk({ state: 'excluded' }, { state: 'excluded' })}>Exclude</button>
            </div>
            <div className="tm__bulkgroupwrap">
              <CatMenu cats={cats} onPick={(c) => bulk({ category: c, autoClassified: false }, { category: c, auto_classified: false }, (t) => categoryAllowed(t.kind))} />
            </div>
            <button className="tm__bulkbtn" onClick={() => bulk({ autoClassified: false }, { auto_classified: false }, (t) => t.autoClassified)}>✓ Confirm</button>
            <BulkMenu label="Synonym of" options={bulkSynCands} onPick={(k) => bulkSynonym(Number(k))} />
            <BulkMenu label="Add to group" options={bulkGroupAdd} onPick={(k) => bulkAddGroup(Number(k))} onCreate={bulkCreateGroup} createNoun="group" />
            {bulkGroupRemove.length > 0 && <BulkMenu label="Remove from group" options={bulkGroupRemove} onPick={(k) => bulkRemoveGroup(Number(k))} />}
          </div>
          <button className="tm__bulkclear" onClick={() => setSelected(new Set())} aria-label="Clear selection">✕</button>
        </div>
      )}

        <div className="tm__thead" role="row">
          <span className="tm__th tm__col-check"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></span>
          <button className="tm__th tm__col-name tm__sortbtn" onClick={() => toggleSort('name')}>Tag{arrow('name')}</button>
          <span className="tm__th tm__col-alias">Display alias</span>
          <span className="tm__th tm__col-kind">Kind</span>
          <span className="tm__th tm__col-cat">Category</span>
          <span className="tm__th tm__col-state">State</span>
          <span className="tm__th tm__col-canon">Canon</span>
          <span className="tm__th tm__col-syn">Synonym of</span>
          <span className="tm__th tm__col-groups">Groups</span>
          <button className="tm__th tm__col-uses tm__sortbtn" onClick={() => toggleSort('count')}>Uses{arrow('count')}</button>
        </div>
      </div>

      <div className="tm__table" role="table" ref={listRef} style={{ position: 'relative', height: rowV.getTotalSize() }}>
        {rowV.getVirtualItems().map((vi) => {
          const t = sorted[vi.index]
          const tagGroups = groupsByTag.get(t.id) ?? []
          const synN = synCountOf(t)
          const isCanon = synN > 0
          return (
            <div key={t.id} data-index={vi.index} ref={rowV.measureElement} className="tm__vrow"
                 style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start - rowV.options.scrollMargin}px)` }}>
            <div className={'tm__row' + (selected.has(t.id) ? ' is-selected' : '')} role="row">
              <span className="tm__td tm__col-check"><input type="checkbox" checked={selected.has(t.id)} onChange={() => toggleSel(t.id)} aria-label={`Select ${t.name}`} /></span>
              <span className="tm__td tm__col-name">
                <span className="tm__tagname">{t.name}</span>
                <button className="tm__inbrowse" title="Show works with this tag in Browse" aria-label="Open in Browse" onClick={() => openInBrowse(t)}>↗</button>
              </span>

              <span className="tm__td tm__col-alias" data-label="Display as">
                <input className="tm__aliasinput" value={t.displayName ?? ''} placeholder="display as…"
                  onChange={(e) => edit(t.id, { displayName: e.target.value || null }, { display_name: e.target.value || null })} />
              </span>

              <span className="tm__td tm__col-kind" data-label="Kind"><span className={'tm__kind tm__kind--' + t.kind}>{KIND_ABBR[t.kind]}</span></span>

              <span className="tm__td tm__col-cat" data-label="Category">
                <span className="tm__catwrap">
                  {categoryAllowed(t.kind) ? (
                    <select className={'tm__cellselect' + (t.category === null ? ' is-uncat' : '')} value={t.category ?? ''}
                      onChange={(e) => edit(t.id, { category: e.target.value || null, autoClassified: e.target.value ? false : t.autoClassified }, { category: e.target.value || null, ...(e.target.value ? { auto_classified: false } : {}) })}>
                      <option value="">uncategorized</option>
                      {cats.map((c) => <option key={c} value={c}>{c}</option>)}
                    </select>
                  ) : <span className="tm__na">—</span>}
                  {t.autoClassified && <button className="tm__auto tm__auto--btn" onClick={() => edit(t.id, { autoClassified: false }, { auto_classified: false })} title="Accept auto-classification">auto ✓</button>}
                </span>
              </span>

              <span className="tm__td tm__col-state" data-label="State">
                <button className={'tm__statetoggle tm__statetoggle--' + t.state}
                  onClick={() => edit(t.id, { state: NEXT_STATE[t.state] }, { state: NEXT_STATE[t.state] })}
                  title={STATE_TITLE[t.state]} aria-label={`State: ${t.state}. Click to set ${NEXT_STATE[t.state]}.`}>
                  {STATE_ICON[t.state]}
                </button>
              </span>

              {/* canonical — derived (read-only): how many tags name this one */}
              <span className="tm__td tm__col-canon" data-label="Canonical">
                {isCanon ? <span className="tm__canon" title={`${synN} synonym${synN === 1 ? '' : 's'}`}>canon · {synN}</span> : <span className="tm__na">—</span>}
              </span>

              {/* synonym-of picker — disabled while this tag is itself a canonical */}
              <span className="tm__td tm__col-syn" data-label="Synonym of">
                <span className="tm__synwrap">
                  <button className={'tm__synbtn' + (t.canonicalTagId ? ' is-set' : '')} disabled={isCanon}
                    onClick={() => { setSynRow((c) => (c === t.id ? null : t.id)); setGroupRow(null) }} aria-expanded={synRow === t.id}
                    title={isCanon ? 'This tag is a canonical; clear its synonyms first' : undefined}>
                    {t.canonicalTagId ? `↳ ${canonName(t.canonicalTagId)}` : 'synonym of…'}
                  </button>
                  {synRow === t.id && (
                    <SearchMenu options={synOptions(t)} placeholder="Filter canonicals…"
                      onPick={(key) => setSynonym(t.id, key ? Number(key) : null)} onClose={() => setSynRow(null)} />
                  )}
                </span>
              </span>

              {/* roll-up groups */}
              <span className="tm__td tm__col-groups" data-label="Groups">
                {tagGroups.map((g) => (
                  <span key={g.id} className={'tm__grp tm__grp--' + g.groupType} title={g.groupType}>
                    <span className="tm__grpmark" aria-hidden>{CLASS_MARK[g.groupType]}</span>{g.name}
                    <button className="tm__grpx" onClick={() => removeFromGroup(g.id, t.id)} aria-label={`Remove from ${g.name}`}>×</button>
                  </span>
                ))}
                <span className="tm__addwrap">
                  <button className="tm__addgrp" onClick={() => { setGroupRow((c) => (c === t.id ? null : t.id)); setSynRow(null) }} aria-expanded={groupRow === t.id}>+ group</button>
                  {groupRow === t.id && (
                    <SearchMenu options={groupOptions(t)} placeholder={`Filter ${groupClassOf(t.kind)} groups…`}
                      onPick={(key) => addToGroup(Number(key), t.id)} onClose={() => setGroupRow(null)}
                      onCreate={(name) => createGroupFor(t.id, name)} createNoun={groupClassOf(t.kind)} />
                  )}
                </span>
              </span>

              <span className="tm__td tm__col-uses" data-label="Uses">{countOf(t).toLocaleString()}</span>
            </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/* A bulk-bar dropdown backed by the searchable SearchMenu (synonym / group pickers). */
function BulkMenu({ label, options, onPick, onCreate, createNoun }: {
  label: string; options: Opt[]; onPick: (key: string) => void
  onCreate?: (name: string) => void; createNoun?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="tm__bulkgroupwrap">
      <button className="tm__bulkbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>{label} ▾</button>
      {open && (
        <SearchMenu options={options} placeholder={`Filter ${label.toLowerCase()}…`}
          onPick={(k) => { onPick(k); setOpen(false) }} onClose={() => setOpen(false)}
          onCreate={onCreate ? (n) => { onCreate(n); setOpen(false) } : undefined} createNoun={createNoun} />
      )}
    </div>
  )
}

function CatMenu({ cats, onPick }: { cats: string[]; onPick: (c: string) => void }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button className="tm__bulkbtn" onClick={() => setOpen((o) => !o)} aria-expanded={open}>Set category ▾</button>
      {open && (
        <>
          <div className="tm__scrim" onClick={() => setOpen(false)} />
          <ul className="tm__menu" role="listbox">
            {cats.map((c) => <li key={c}><button className="tm__menuitem" onClick={() => { onPick(c); setOpen(false) }}>{c}</button></li>)}
          </ul>
        </>
      )}
    </>
  )
}

/* -------------------------- Categories view ----------------------------- */
/* The freeform category SET + global lock (/api/categories). Once locked, every
   mutation is disabled here AND rejected by the hub (the hard rule, §12.6). Per-
   category tag counts come from the live tag list. */
function CategoriesView({ tab, setTab }: TabProps) {
  const [cats, setCats] = useState<Category[]>([])
  const [locked, setLocked] = useState(false)
  const [counts, setCounts] = useState<Map<string, number>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [adding, setAdding] = useState(false)
  const [newName, setNewName] = useState('')

  useEffect(() => {
    Promise.all([fetchCategories(), fetchTags()])
      .then(([cl, ts]) => {
        setCats(cl.categories); setLocked(cl.locked)
        const m = new Map<string, number>()
        for (const t of ts) if (t.category) m.set(t.category, (m.get(t.category) ?? 0) + 1)
        setCounts(m)
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const refresh = () => fetchCategories().then((cl) => { setCats(cl.categories); setLocked(cl.locked) }).catch(() => {})
  const fail = (e: unknown) => alert(`Save failed: ${e instanceof Error ? e.message : e}`)

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (locked || j < 0 || j >= cats.length) return
    const next = [...cats]; [next[i], next[j]] = [next[j], next[i]]
    setCats(next)
    reorderCategories(next.map((c) => c.id)).then((cl) => { setCats(cl.categories); markSnapshotDirty() }).catch((e) => { fail(e); refresh() })
  }
  const commitRename = (c: Category) => {
    const name = draft.trim()
    setEditing(null)
    if (!name || name === c.name) return
    setCats((prev) => prev.map((x) => (x.id === c.id ? { ...x, name } : x)))
    renameCategory(c.id, name).then((u) => { setCats((prev) => prev.map((x) => (x.id === u.id ? u : x))); markSnapshotDirty() }).catch((e) => { fail(e); refresh() })
  }
  const remove = (c: Category) => {
    const n = counts.get(c.name) ?? 0
    if (!window.confirm(`Delete category “${c.name}”?${n ? ` ${n} tag${n === 1 ? '' : 's'} will become uncategorized.` : ''}`)) return
    setCats((prev) => prev.filter((x) => x.id !== c.id))
    deleteCategory(c.id).then(() => markSnapshotDirty()).catch((e) => { fail(e); refresh() })
  }
  const commitAdd = () => {
    const name = newName.trim()
    setAdding(false); setNewName('')
    if (!name) return
    createCategory(name).then((c) => { setCats((prev) => [...prev, c]); markSnapshotDirty() }).catch((e) => { fail(e); refresh() })
  }
  const toggleLock = () => {
    const next = !locked
    if (next && !window.confirm('Lock the category list? Adding, renaming, reordering, and deleting categories will be disabled until you unlock.')) return
    if (!next && !window.confirm('Unlock the category list? The redesign treats the locked set as fixed — only unlock for a deliberate revision.')) return
    setLocked(next)
    setCategoryLock(next).then((cl) => { setCats(cl.categories); setLocked(cl.locked) }).catch((e) => { fail(e); refresh() })
  }

  if (loading) return <><div className="tm__sticky"><TmHeader tab={tab} setTab={setTab} /></div><p style={pad}>Loading…</p></>
  if (error) return <><div className="tm__sticky"><TmHeader tab={tab} setTab={setTab} /></div><p style={pad}>Couldn’t load: {error}</p></>

  return (
    <>
      <div className="tm__sticky">
      <TmHeader tab={tab} setTab={setTab} />
      <div className="tm__catbar">
        <button className="tm__bulkbtn" disabled={locked || adding} onClick={() => { setAdding(true); setNewName('') }}>+ Add category</button>
        <button className={'tm__bulkbtn' + (locked ? ' is-locked' : '')} onClick={toggleLock}>
          {locked ? '🔒 Locked — unlock' : 'Lock category list'}
        </button>
      </div>
      </div>

      <ol className="tm__catlist">
        {cats.map((c, i) => (
          <li key={c.id} className="tm__catrow">
            <span className="tm__catpos">{i + 1}</span>
            <div className="tm__catreorder">
              <button className="tm__catarrow" disabled={locked || i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button>
              <button className="tm__catarrow" disabled={locked || i === cats.length - 1} onClick={() => move(i, 1)} aria-label="Move down">▼</button>
            </div>
            {editing === c.id ? (
              <input className="tm__catinput" value={draft} autoFocus
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitRename(c); if (e.key === 'Escape') setEditing(null) }}
                onBlur={() => commitRename(c)} />
            ) : (
              <span className="tm__catname">{c.name}</span>
            )}
            <span className="tm__catcount">{counts.get(c.name) ?? 0} tags</span>
            <button className="tm__catedit" disabled={locked} onClick={() => { setEditing(c.id); setDraft(c.name) }} aria-label="Rename">✎</button>
            <button className="tm__catedit" disabled={locked} onClick={() => remove(c)} aria-label="Delete">🗑</button>
          </li>
        ))}
        {adding && (
          <li className="tm__catrow">
            <span className="tm__catpos">{cats.length + 1}</span>
            <div className="tm__catreorder" />
            <input className="tm__catinput" value={newName} autoFocus placeholder="New category name…"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') commitAdd(); if (e.key === 'Escape') { setAdding(false); setNewName('') } }}
              onBlur={commitAdd} />
          </li>
        )}
        {cats.length === 0 && !adding && <li className="tm__catrow"><span className="tm__na" style={{ padding: '4px 0' }}>No categories yet.</span></li>}
      </ol>
    </>
  )
}

const pad: React.CSSProperties = { padding: 'var(--space-4)', color: 'var(--text-muted)' }
