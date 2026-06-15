import { useMemo, useState } from 'react'
import './TagManagement.css'
import {
  type ManagedTag, type TagKind, type TagState, type Category, type TagGroupRef,
  MANAGED_TAGS, FREEFORM_CATEGORIES, TAG_GROUPS, groupClassOf, synonymDomainOf,
} from '../mock/data'
import { Button } from './Button'

/* Tag Management (redesign §12.6 + §6.3.1 refinement). Three composable layers —
   canonical+synonyms (equivalence), display alias (rename), roll-up groups
   (collection/property, class inferred from member kind) — all edited INLINE in
   the grid (no pencil). Group + synonym pickers are searchable + alphabetised
   (real lists are huge). The Review Queue never touches any of this. */

const KINDS: TagKind[] = ['fandom', 'relationship', 'character', 'freeform', 'warning']
const KIND_ABBR: Record<TagKind, string> = {
  fandom: 'Fandom', relationship: 'Ship', character: 'Char', freeform: 'Freeform', warning: 'Warning',
}
const CLASS_MARK = { collection: '▣', property: '◆' } as const
const categoryAllowed = (k: TagKind) => k === 'freeform' || k === 'warning'

/* ---- searchable, alphabetised dropdown (groups + synonyms; line + bulk) ---- */
type Opt = { key: string; label: string; mark?: string; sub?: string }
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
  const filtered = options
    .filter((o) => o.label.toLowerCase().includes(ql))
    .sort((a, b) => a.label.localeCompare(b.label))
  const exact = options.some((o) => o.label.toLowerCase() === ql)
  return (
    <>
      <div className="tm__scrim" onClick={onClose} />
      <div className="tm__menu">
        <input className="tm__menusearch" autoFocus placeholder={placeholder ?? 'Filter…'} value={q} onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && onCreate && q.trim() && !exact) onCreate(q.trim()) }} />
        <ul className="tm__optlist">
          {filtered.length === 0 && !onCreate && <li className="tm__menuempty">no matches</li>}
          {filtered.map((o) => (
            <li key={o.key}>
              <button className="tm__menuitem" onClick={() => onPick(o.key)}>
                {o.mark && <span className="tm__grpmark" aria-hidden>{o.mark}</span>}{o.label}
                {o.sub && <span className="tm__menutype">{o.sub}</span>}
              </button>
            </li>
          ))}
        </ul>
        {onCreate && q.trim() && !exact && (
          <button className="tm__create" onClick={() => onCreate(q.trim())}>+ Create {createNoun} “{q.trim()}”</button>
        )}
      </div>
    </>
  )
}

export function TagManagement() {
  const [tab, setTab] = useState<'tags' | 'categories'>('tags')
  return (
    <div className="tm">
      <header className="tm__head">
        <h1 className="tm__title">Tags</h1>
        <div className="tm__tabs" role="tablist">
          <button className={'tm__tab' + (tab === 'tags' ? ' is-on' : '')} onClick={() => setTab('tags')}>Tags</button>
          <button className={'tm__tab' + (tab === 'categories' ? ' is-on' : '')} onClick={() => setTab('categories')}>Categories</button>
        </div>
      </header>
      {tab === 'tags' ? <TagsView /> : <CategoriesView />}
    </div>
  )
}

/* ----------------------------- Tags view -------------------------------- */
function TagsView() {
  const [tags, setTags] = useState<ManagedTag[]>(MANAGED_TAGS)
  const [allGroups, setAllGroups] = useState<TagGroupRef[]>(TAG_GROUPS)
  const [search, setSearch] = useState('')
  const [kind, setKind] = useState<TagKind | 'all'>('all')
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [state, setState] = useState<TagState | 'all'>('all')
  const [quick, setQuick] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [sort, setSort] = useState<{ key: 'name' | 'count'; dir: 'asc' | 'desc' }>({ key: 'name', dir: 'asc' })
  const [synRow, setSynRow] = useState<number | null>(null)
  const [groupRow, setGroupRow] = useState<number | null>(null)
  const [lastAction, setLastAction] = useState<string | null>(null)

  const toggleSort = (key: 'name' | 'count') =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'count' ? 'desc' : 'asc' }))
  const sortArrow = (key: 'name' | 'count') => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')
  const toggleQuick = (q: string) =>
    setQuick((prev) => { const n = new Set(prev); n.has(q) ? n.delete(q) : n.add(q); return n })

  const filtered = useMemo(
    () => tags.filter((t) => {
      if (search && !(t.name.toLowerCase().includes(search.toLowerCase()) || (t.displayName ?? '').toLowerCase().includes(search.toLowerCase()))) return false
      if (kind !== 'all' && t.kind !== kind) return false
      if (cat !== 'all' && t.category !== cat) return false
      if (state !== 'all' && t.state !== state) return false
      if (quick.has('uncat') && !(t.category === null && categoryAllowed(t.kind))) return false
      if (quick.has('ungrouped') && (t.groups.length > 0 || !!t.synonymOf)) return false
      if (quick.has('auto') && !t.autoClassified) return false
      return true
    }),
    [tags, search, kind, cat, state, quick],
  )
  const sorted = useMemo(() => {
    const arr = [...filtered]
    arr.sort((a, b) => {
      const d = sort.key === 'name' ? a.name.localeCompare(b.name) : a.count - b.count
      return sort.dir === 'asc' ? d : -d
    })
    return arr
  }, [filtered, sort])

  const canonicals = useMemo(() => tags.filter((t) => t.canonical), [tags])
  const canonName = (name: string) => {
    const c = tags.find((t) => t.name === name)
    return c ? (c.displayName ?? c.name) : name
  }

  const allSelected = filtered.length > 0 && filtered.every((t) => selected.has(t.id))
  const toggleSel = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(filtered.map((t) => t.id)))

  const editOne = (id: number, fn: (t: ManagedTag) => ManagedTag) =>
    setTags((prev) => prev.map((t) => (t.id === id ? fn(t) : t)))

  // identity (layers 1 & 2), inline
  const setAlias = (id: number, v: string) => editOne(id, (t) => ({ ...t, displayName: v || undefined }))
  const toggleCanonical = (id: number) =>
    editOne(id, (t) => (t.canonical ? { ...t, canonical: false } : { ...t, canonical: true, synonymOf: undefined }))
  const setSynonymOf = (id: number, name: string) =>
    setTags((prev) => prev.map((t) => {
      if (t.id === id) return { ...t, synonymOf: name || undefined, canonical: name ? false : t.canonical }
      if (name && t.name === name) return { ...t, canonical: true }
      return t
    }))

  // groups (layer 3), inline
  const addGroup = (id: number, ref: TagGroupRef) =>
    editOne(id, (t) => (t.groups.some((x) => x.name === ref.name) ? t : { ...t, groups: [...t.groups, ref] }))
  const removeGroup = (id: number, name: string) =>
    editOne(id, (t) => ({ ...t, groups: t.groups.filter((x) => x.name !== name) }))
  const createGroup = (id: number, name: string, kindOf: TagKind) => {
    const ref: TagGroupRef = { name, cls: groupClassOf(kindOf) }
    setAllGroups((prev) => (prev.some((g) => g.name === name) ? prev : [...prev, ref]))
    addGroup(id, ref)
  }

  // bulk
  const editSel = (fn: (t: ManagedTag) => ManagedTag) =>
    setTags((prev) => prev.map((t) => (selected.has(t.id) ? fn(t) : t)))
  const n = selected.size
  const bulkState = (s: TagState) => { editSel((t) => ({ ...t, state: s })); setLastAction(`${n} → ${s}`) }
  const bulkCategory = (c: Category) => { editSel((t) => (categoryAllowed(t.kind) ? { ...t, category: c, autoClassified: false } : t)); setLastAction(`${n} → ${c}`) }
  const bulkAddGroup = (ref: TagGroupRef) => { editSel((t) => (groupClassOf(t.kind) === ref.cls && !t.groups.some((x) => x.name === ref.name) ? { ...t, groups: [...t.groups, ref] } : t)); setLastAction(`+ group “${ref.name}”`) }
  const bulkRemoveGroup = (ref: TagGroupRef) => { editSel((t) => ({ ...t, groups: t.groups.filter((x) => x.name !== ref.name) })); setLastAction(`− group “${ref.name}”`) }
  const bulkSynonymOf = (name: string) => {
    const target = tags.find((t) => t.name === name)
    if (!target) return
    const dom = synonymDomainOf(target)
    setTags((prev) => prev.map((t) => {
      if (selected.has(t.id) && t.name !== name && synonymDomainOf(t) === dom) return { ...t, synonymOf: name, canonical: false }
      if (t.name === name) return { ...t, canonical: true }
      return t
    }))
    setLastAction(`synonyms → ${canonName(name)}`)
  }
  const bulkConfirm = () => { editSel((t) => (t.autoClassified ? { ...t, autoClassified: false } : t)); setLastAction(`${n} confirmed`) }
  const clearSel = () => { setSelected(new Set()); setLastAction(null) }

  const selectedGroups = useMemo(() => {
    const m = new Map<string, TagGroupRef>()
    for (const t of tags) if (selected.has(t.id)) for (const grp of t.groups) m.set(grp.name, grp)
    return [...m.values()]
  }, [tags, selected])
  const selectedHasAuto = useMemo(() => tags.some((t) => selected.has(t.id) && t.autoClassified), [tags, selected])

  return (
    <>
      <div className="tm__filters">
        <input className="tm__search" placeholder="Search tags…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <select className="tm__select" value={kind} onChange={(e) => setKind(e.target.value as TagKind | 'all')}>
          <option value="all">All kinds</option>
          {KINDS.map((k) => <option key={k} value={k}>{KIND_ABBR[k]}</option>)}
        </select>
        <select className="tm__select" value={cat} onChange={(e) => setCat(e.target.value as Category | 'all')}>
          <option value="all">All categories</option>
          {FREEFORM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
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
        <BulkBar
          count={selected.size}
          lastAction={lastAction}
          allGroups={allGroups}
          removableGroups={selectedGroups}
          canonicals={canonicals}
          hasAuto={selectedHasAuto}
          onState={bulkState}
          onCategory={bulkCategory}
          onAddGroup={bulkAddGroup}
          onRemoveGroup={bulkRemoveGroup}
          onSynonymOf={bulkSynonymOf}
          onConfirm={bulkConfirm}
          onClear={clearSel}
        />
      )}

      <div className="tm__table" role="table">
        <div className="tm__thead" role="row">
          <span className="tm__th tm__col-check"><input type="checkbox" checked={allSelected} onChange={toggleAll} aria-label="Select all" /></span>
          <button className="tm__th tm__col-name tm__sortbtn" onClick={() => toggleSort('name')}>Tag{sortArrow('name')}</button>
          <span className="tm__th tm__col-alias">Display alias</span>
          <span className="tm__th tm__col-kind">Kind</span>
          <span className="tm__th tm__col-cat">Category</span>
          <span className="tm__th tm__col-state">State</span>
          <span className="tm__th tm__col-canon">Canonical</span>
          <span className="tm__th tm__col-syn">Synonym of</span>
          <span className="tm__th tm__col-groups">Groups</span>
          <button className="tm__th tm__col-uses tm__sortbtn" onClick={() => toggleSort('count')}>Uses{sortArrow('count')}</button>
        </div>
        {sorted.map((t) => (
          <TagRow
            key={t.id}
            tag={t}
            selected={selected.has(t.id)}
            allGroups={allGroups}
            canonicals={canonicals}
            canonName={canonName}
            synOpen={synRow === t.id}
            groupOpen={groupRow === t.id}
            onToggleSyn={() => { setSynRow((c) => (c === t.id ? null : t.id)); setGroupRow(null) }}
            onToggleGroup={() => { setGroupRow((c) => (c === t.id ? null : t.id)); setSynRow(null) }}
            onSelect={() => toggleSel(t.id)}
            onAlias={(v) => setAlias(t.id, v)}
            onToggleCanonical={() => toggleCanonical(t.id)}
            onSynonymOf={(name) => { setSynonymOf(t.id, name); setSynRow(null) }}
            onSetState={(s) => editOne(t.id, (x) => ({ ...x, state: s }))}
            onSetCategory={(c) => editOne(t.id, (x) => ({ ...x, category: c, autoClassified: c === null ? x.autoClassified : false }))}
            onConfirmAuto={() => editOne(t.id, (x) => ({ ...x, autoClassified: false }))}
            onAddGroup={(ref) => { addGroup(t.id, ref); setGroupRow(null) }}
            onCreateGroup={(name) => { createGroup(t.id, name, t.kind); setGroupRow(null) }}
            onRemoveGroup={(name) => removeGroup(t.id, name)}
          />
        ))}
      </div>
    </>
  )
}

function TagRow({
  tag, selected, allGroups, canonicals, canonName, synOpen, groupOpen,
  onToggleSyn, onToggleGroup, onSelect, onAlias, onToggleCanonical, onSynonymOf,
  onSetState, onSetCategory, onConfirmAuto, onAddGroup, onCreateGroup, onRemoveGroup,
}: {
  tag: ManagedTag
  selected: boolean
  allGroups: TagGroupRef[]
  canonicals: ManagedTag[]
  canonName: (name: string) => string
  synOpen: boolean
  groupOpen: boolean
  onToggleSyn: () => void
  onToggleGroup: () => void
  onSelect: () => void
  onAlias: (v: string) => void
  onToggleCanonical: () => void
  onSynonymOf: (name: string) => void
  onSetState: (s: TagState) => void
  onSetCategory: (c: Category | null) => void
  onConfirmAuto: () => void
  onAddGroup: (g: TagGroupRef) => void
  onCreateGroup: (name: string) => void
  onRemoveGroup: (name: string) => void
}) {
  const synOpts: Opt[] = [
    ...(tag.synonymOf ? [{ key: '', label: '— not a synonym —' }] : []),
    ...canonicals
      .filter((c) => c.id !== tag.id && synonymDomainOf(c) === synonymDomainOf(tag))
      .map((c) => ({ key: c.name, label: c.displayName ? `${c.name} → ${c.displayName}` : c.name })),
  ]
  const groupOpts: Opt[] = allGroups
    .filter((g) => g.cls === groupClassOf(tag.kind) && !tag.groups.some((x) => x.name === g.name))
    .map((g) => ({ key: g.name, label: g.name, mark: CLASS_MARK[g.cls], sub: g.cls }))
  const cls = groupClassOf(tag.kind)

  return (
    <div className={'tm__row' + (selected ? ' is-selected' : '')} role="row">
      <span className="tm__td tm__col-check"><input type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${tag.name}`} /></span>

      <span className="tm__td tm__col-name"><span className="tm__tagname">{tag.name}</span></span>

      <span className="tm__td tm__col-alias" data-label="Display as">
        <input className="tm__aliasinput" value={tag.displayName ?? ''} placeholder="display as…" onChange={(e) => onAlias(e.target.value)} />
      </span>

      <span className="tm__td tm__col-kind" data-label="Kind"><span className={'tm__kind tm__kind--' + tag.kind}>{KIND_ABBR[tag.kind]}</span></span>

      <span className="tm__td tm__col-cat" data-label="Category">
        <span className="tm__catwrap">
          {categoryAllowed(tag.kind) ? (
            <select className={'tm__cellselect' + (tag.category === null ? ' is-uncat' : '')} value={tag.category ?? ''} onChange={(e) => onSetCategory(e.target.value === '' ? null : (e.target.value as Category))}>
              <option value="">uncategorized</option>
              {FREEFORM_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          ) : (
            <span className="tm__na">—</span>
          )}
          {tag.autoClassified && <button className="tm__auto tm__auto--btn" onClick={onConfirmAuto} title="Accept auto-classification">auto ✓</button>}
        </span>
      </span>

      <span className="tm__td tm__col-state" data-label="State">
        <select className={'tm__cellselect tm__statesel tm__statesel--' + tag.state} value={tag.state} onChange={(e) => onSetState(e.target.value as TagState)}>
          <option value="favorite">★ Favorite</option>
          <option value="normal">Normal</option>
          <option value="excluded">⊘ Excluded</option>
        </select>
      </span>

      {/* canonical toggle */}
      <span className="tm__td tm__col-canon" data-label="Canonical">
        <input type="checkbox" checked={!!tag.canonical} disabled={!!tag.synonymOf} onChange={onToggleCanonical} title="Canonical owns a synonym set" aria-label="Canonical" />
      </span>

      {/* synonym-of picker */}
      <span className="tm__td tm__col-syn" data-label="Synonym of">
        <span className="tm__synwrap">
          <button className={'tm__synbtn' + (tag.synonymOf ? ' is-set' : '')} onClick={onToggleSyn} aria-expanded={synOpen} disabled={!!tag.canonical}>
            {tag.synonymOf ? `↳ ${canonName(tag.synonymOf)}` : 'synonym of…'}
          </button>
          {synOpen && <SearchMenu options={synOpts} placeholder="Filter canonicals…" onPick={onSynonymOf} onClose={onToggleSyn} />}
        </span>
      </span>

      {/* roll-up groups */}
      <span className="tm__td tm__col-groups" data-label="Groups">
        {tag.groups.map((grp) => (
          <span key={grp.name} className={'tm__grp tm__grp--' + grp.cls} title={grp.cls}>
            <span className="tm__grpmark" aria-hidden>{CLASS_MARK[grp.cls]}</span>{grp.name}
            <button className="tm__grpx" onClick={() => onRemoveGroup(grp.name)} aria-label={`Remove ${grp.name}`}>×</button>
          </span>
        ))}
        <span className="tm__addwrap">
          <button className="tm__addgrp" onClick={onToggleGroup} aria-expanded={groupOpen}>+ group</button>
          {groupOpen && (
            <SearchMenu
              options={groupOpts}
              placeholder={`Filter ${cls} groups…`}
              onPick={(name) => { const g = allGroups.find((x) => x.name === name); if (g) onAddGroup(g) }}
              onCreate={onCreateGroup}
              createNoun={cls}
              onClose={onToggleGroup}
            />
          )}
        </span>
      </span>

      <span className="tm__td tm__col-uses" data-label="Uses">{tag.count.toLocaleString()}</span>
    </div>
  )
}

function BulkBar({
  count, lastAction, allGroups, removableGroups, canonicals, hasAuto,
  onState, onCategory, onAddGroup, onRemoveGroup, onSynonymOf, onConfirm, onClear,
}: {
  count: number
  lastAction: string | null
  allGroups: TagGroupRef[]
  removableGroups: TagGroupRef[]
  canonicals: ManagedTag[]
  hasAuto: boolean
  onState: (s: TagState) => void
  onCategory: (c: Category) => void
  onAddGroup: (g: TagGroupRef) => void
  onRemoveGroup: (g: TagGroupRef) => void
  onSynonymOf: (name: string) => void
  onConfirm: () => void
  onClear: () => void
}) {
  const [menu, setMenu] = useState<null | 'cat' | 'add' | 'remove' | 'syn'>(null)
  const toggle = (m: 'cat' | 'add' | 'remove' | 'syn') => setMenu((cur) => (cur === m ? null : m))
  const close = () => setMenu(null)
  const groupOpts = (gs: TagGroupRef[]): Opt[] => gs.map((g) => ({ key: g.name, label: g.name, mark: CLASS_MARK[g.cls], sub: g.cls }))
  const canonOpts: Opt[] = canonicals.map((c) => ({ key: c.name, label: c.displayName ? `${c.name} → ${c.displayName}` : c.name }))

  return (
    <div className="tm__bulk" role="toolbar" aria-label="Bulk tag actions">
      <span className="tm__bulkcount">{count} selected</span>
      <div className="tm__bulkactions">
        <div className="tm__bulkgroup">
          <button className="tm__bulkbtn" onClick={() => onState('favorite')}>★ Favorite</button>
          <button className="tm__bulkbtn" onClick={() => onState('normal')}>Normal</button>
          <button className="tm__bulkbtn" onClick={() => onState('excluded')}>Exclude</button>
        </div>

        <div className="tm__bulkgroupwrap">
          <button className="tm__bulkbtn" onClick={() => toggle('cat')} aria-expanded={menu === 'cat'}>Set category ▾</button>
          {menu === 'cat' && (
            <>
              <div className="tm__scrim" onClick={close} />
              <ul className="tm__menu" role="listbox">
                {FREEFORM_CATEGORIES.map((c) => <li key={c}><button className="tm__menuitem" onClick={() => { onCategory(c); close() }}>{c}</button></li>)}
              </ul>
            </>
          )}
        </div>

        <div className="tm__bulkgroupwrap">
          <button className="tm__bulkbtn" onClick={() => toggle('add')} aria-expanded={menu === 'add'}>Add to group ▾</button>
          {menu === 'add' && <SearchMenu options={groupOpts(allGroups)} placeholder="Filter groups…" onPick={(name) => { const g = allGroups.find((x) => x.name === name); if (g) onAddGroup(g) }} onClose={close} />}
        </div>

        <div className="tm__bulkgroupwrap">
          <button className="tm__bulkbtn" disabled={removableGroups.length === 0} onClick={() => toggle('remove')} aria-expanded={menu === 'remove'}>Remove from group ▾</button>
          {menu === 'remove' && <SearchMenu options={groupOpts(removableGroups)} placeholder="Filter groups…" onPick={(name) => { const g = removableGroups.find((x) => x.name === name); if (g) onRemoveGroup(g) }} onClose={close} />}
        </div>

        <div className="tm__bulkgroupwrap">
          <button className="tm__bulkbtn" disabled={canonicals.length === 0} onClick={() => toggle('syn')} aria-expanded={menu === 'syn'}>Synonym of ▾</button>
          {menu === 'syn' && <SearchMenu options={canonOpts} placeholder="Filter canonicals…" onPick={(name) => { onSynonymOf(name); close() }} onClose={close} />}
        </div>

        <button className="tm__bulkbtn" disabled={!hasAuto} onClick={onConfirm}>✓ Confirm</button>

        {lastAction && <span className="tm__bulkdone">✓ {lastAction}</span>}
      </div>
      <button className="tm__bulkclear" onClick={onClear} aria-label="Clear selection">✕</button>
    </div>
  )
}

/* -------------------------- Categories view ----------------------------- */
function CategoriesView() {
  const [cats, setCats] = useState<string[]>(FREEFORM_CATEGORIES as string[])
  const [locked, setLocked] = useState(false)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    for (const t of MANAGED_TAGS) if (t.category) m.set(t.category, (m.get(t.category) ?? 0) + 1)
    return m
  }, [])

  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir
    if (j < 0 || j >= cats.length) return
    setCats((prev) => { const next = [...prev]; [next[i], next[j]] = [next[j], next[i]]; return next })
  }
  const rename = (i: number) => {
    setCats((prev) => prev.map((c, idx) => (idx === i ? draft.trim() || c : c)))
    setEditing(null)
  }

  return (
    <div className="tm__cats">
      <div className="tm__catbar">
        <Button variant="secondary" size="sm" disabled={locked}>+ Add category</Button>
        <Button variant={locked ? 'outline' : 'danger'} size="sm" onClick={() => setLocked((l) => !l)}>
          {locked ? '🔒 Locked — unlock' : 'Lock category list'}
        </Button>
      </div>
      <ol className="tm__catlist">
        {cats.map((c, i) => (
          <li key={c} className="tm__catrow">
            <span className="tm__catpos">{i + 1}</span>
            <div className="tm__catreorder">
              <button className="tm__catarrow" disabled={locked || i === 0} onClick={() => move(i, -1)} aria-label="Move up">▲</button>
              <button className="tm__catarrow" disabled={locked || i === cats.length - 1} onClick={() => move(i, 1)} aria-label="Move down">▼</button>
            </div>
            {editing === i ? (
              <input className="tm__catinput" value={draft} autoFocus onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && rename(i)} onBlur={() => rename(i)} />
            ) : (
              <span className="tm__catname">{c}</span>
            )}
            <span className="tm__catcount">{counts.get(c) ?? 0} tags</span>
            <button className="tm__catedit" disabled={locked} onClick={() => { setEditing(i); setDraft(c) }} aria-label="Rename">✎</button>
          </li>
        ))}
      </ol>
    </div>
  )
}
