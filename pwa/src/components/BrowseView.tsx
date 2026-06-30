import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import './BrowseView.css'
import { StoryCard } from './StoryCard'
import { FilterPanel } from './FilterPanel'
import { BulkBar } from './BulkBar'
import { Reader } from './Reader'
import { FunnelIcon, SortIcon } from './Icons'
import { SORT_OPTIONS } from '../mock/data'
import { comparator } from '../data/sort'
import { useLibrary } from '../data/library'
import { useNav } from '../data/appnav'
import { applyFilters, buildFacets, dependentFacets, emptyFilter, activeCount, type FilterState } from '../data/filters'
import { createSavedFilter, fetchReadingLists, fetchSavedFilters, type ReadingListRow, type SavedFilterRow } from '../data/lists'
import { fetchFavoriteTagNames, setTagStateByBrowse, readKeptFandomNames } from '../data/tags'
import { isSnapshotDirty, markSnapshotDirty, onSnapshotDirtyChange, rebuildSnapshot } from '../data/snapshot'
import { usePersistentState } from '../data/persist'
import { PrimaryEditor } from './PrimaryEditor'
import type { Work } from '../data/types'

/* The quick-chip row holds two starred kinds, color-coded: reading LISTS (★) and
   saved FILTERS (funnel glyph), both loaded live from the hub. Saved filters are
   CREATED here on Browse — where the filters are live — and edited on the Saved
   Filters surface. A list chip filters to that list's members; a filter chip
   loads its saved FilterState. */
const DOCK_AT = 880 // px: filter panel docks at/above this container width

/* The Browse surface (browse.md + §12.3). Search always visible; sort + filters
   are compact icon controls. The filter panel docks on the right when wide and
   is a slide-in drawer when narrow — one Filters button toggles it either way
   (open by default when docked). Result list virtualizes at Phase F. */
export function BrowseView() {
  const ref = useRef<HTMLDivElement>(null)
  const resultsRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(true)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  // Persisted (survive navigation + app reload): sort, search, filter, active chip.
  const [sortLabel, setSortLabel] = usePersistentState('sh.browse.sort', SORT_OPTIONS[0].label)
  const sort = SORT_OPTIONS.find((o) => o.label === sortLabel) ?? SORT_OPTIONS[0]
  const setSort = (o: typeof SORT_OPTIONS[number]) => setSortLabel(o.label)
  const [sortMenu, setSortMenu] = useState(false)
  const [query, setQuery] = usePersistentState('sh.browse.query', '')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [readerWork, setReaderWork] = useState<Work | null>(null)
  const [filter, setFilter] = usePersistentState<FilterState>('sh.browse.filter', emptyFilter)
  const [quickLists, setQuickLists] = useState<ReadingListRow[]>([])
  const [quickFilters, setQuickFilters] = useState<SavedFilterRow[]>([])
  const [activeList, setActiveList] = useState<ReadingListRow | null>(null)
  const [activeChip, setActiveChip] = usePersistentState<string | null>('sh.browse.activeChip', null)
  const [favTags, setFavTags] = useState<Set<string>>(new Set())
  const [editingWork, setEditingWork] = useState<Work | null>(null)

  const { works, update, db, patchLocal } = useLibrary()
  const { pending, consumePending } = useNav()
  const persist = (workId: number, edit: Parameters<typeof update>[1]) =>
    update(workId, edit).then((err) => { if (err) alert(`Save failed: ${err}`) })
  // Kept fandoms = fandoms that are some work's primary collection (derived). The
  // Browse Fandom filter is restricted to these so non-primary crossover/anthology
  // fandoms don't clutter it (chips on cards are unaffected).
  const keptFandoms = useMemo(() => readKeptFandomNames(db), [db])
  const facets = useMemo(() => buildFacets(works, favTags, keptFandoms), [works, favTags, keptFandoms])

  // Persist a favorited chip. The hub resolves the live canonical tag from the box
  // (category) + chip label (name) — live, not the snapshot, so it can't drift from
  // the favorite stars (which are also read live).
  const rollback = (name: string, fav: boolean) =>
    setFavTags((prev) => { const n = new Set(prev); fav ? n.delete(name) : n.add(name); return n })
  const toggleTagFavorite = (category: string, name: string, fav: boolean) => {
    setFavTags((prev) => { const n = new Set(prev); fav ? n.add(name) : n.delete(name); return n })
    setTagStateByBrowse(name, category, fav ? 'favorite' : 'normal')
      .then((updated) => {
        if (updated === 0) { rollback(name, fav); alert(`Couldn't find “${name}” to ${fav ? 'favorite' : 'unfavorite'}.`) }
      })
      .catch((e) => { rollback(name, fav); alert(`Save failed: ${e instanceof Error ? e.message : e}`) })
  }

  // Favorites is a client-synthesized system list; the rest are starred API lists.
  const favoriteIds = useMemo(() => works.filter((w) => w.isFavorite).map((w) => w.workId), [works])
  const listChips: ReadingListRow[] = useMemo(() => [
    { id: 'favorites', name: 'Favorites', description: null, color: null, autoPin: false, isSystem: true, starred: true, memberIds: favoriteIds },
    ...quickLists.filter((l) => !l.isSystem),
  ], [quickLists, favoriteIds])

  // Works in scope before the filter panel (text search + active reading-list chip).
  // The dependent facets are computed against this set so search / a list chip
  // narrow the available filter options too.
  const searched = useMemo(() => {
    const q = query.trim().toLowerCase()
    let base = works
    if (activeList) {
      const member = new Set(activeList.memberIds)
      base = base.filter((w) => member.has(w.workId))
    }
    return q
      ? base.filter((w) =>
          w.title.toLowerCase().includes(q) ||
          w.authors.some((a) => a.toLowerCase().includes(q)) ||
          w.summary.toLowerCase().includes(q) ||
          (w.primaryShip ?? '').toLowerCase().includes(q))
      : base
  }, [works, query, activeList])

  const results = useMemo(() => [...applyFilters(searched, filter)].sort(comparator(sort.label)), [searched, filter, sort])
  // Co-occurrence-aware facet counts for the panel (leave-one-out per facet).
  const facetLive = useMemo(() => dependentFacets(searched, filter), [searched, filter])

  // Group works by series name so a card can show its in-library siblings. Only
  // series with ≥2 works in the library are kept (a lone part stays a plain card);
  // siblings are the full Works (sorted by series index) so a row can expand into a
  // real sub-card.
  const seriesMap = useMemo(() => {
    const byName = new Map<string, Work[]>()
    for (const w of works) {
      const name = w.seriesName?.trim()
      if (!name) continue
      const arr = byName.get(name)
      if (arr) arr.push(w)
      else byName.set(name, [w])
    }
    for (const [name, arr] of byName) {
      if (arr.length < 2) byName.delete(name)
      else arr.sort((a, b) => (a.seriesIndex ?? Infinity) - (b.seriesIndex ?? Infinity))
    }
    return byName
  }, [works])
  // Which works are in the current filtered results — drives the "N of M match" line.
  const resultIds = useMemo(() => new Set(results.map((w) => w.workId)), [results])
  // Attach the assembled (filter-dependent) series object to a card for rendering.
  const withSeries = (w: Work): Work => {
    const sibs = w.seriesName ? seriesMap.get(w.seriesName.trim()) : undefined
    if (!sibs) return w
    return {
      ...w,
      series: {
        name: w.seriesName!.trim(),
        index: w.seriesIndex ?? sibs.findIndex((s) => s.workId === w.workId) + 1,
        total: sibs.length,
        siblings: sibs,
        matchIds: sibs.filter((s) => resultIds.has(s.workId)).map((s) => s.workId),
      },
    }
  }

  const filterCount = activeCount(filter)

  // Load the starred quick-chips (lists + filters) and favorited tags live.
  useEffect(() => {
    fetchReadingLists().then((ls) => setQuickLists(ls.filter((l) => l.starred))).catch(() => {})
    fetchSavedFilters().then((fs) => setQuickFilters(fs.filter((f) => f.starred))).catch(() => {})
    fetchFavoriteTagNames().then(setFavTags).catch(() => {})
  }, [])

  // After a reload, re-attach a persisted reading-LIST chip once the lists arrive
  // (its membership isn't in `filter`; saved-FILTER chips restore via `filter`).
  useEffect(() => {
    if (activeChip?.startsWith('l') && !activeList) {
      const l = listChips.find((x) => 'l' + x.id === activeChip)
      if (l) setActiveList(l)
    }
  }, [listChips, activeChip, activeList])

  // Consume a filter handed over from the Saved Filters surface ("Apply").
  useEffect(() => {
    if (!pending) return
    setFilter(pending.filter)
    setActiveList(null)
    if (pending.sort) {
      const opt = SORT_OPTIONS.find((o) => o.label === pending.sort || o.short === pending.sort)
      if (opt) setSort(opt)
    }
    setActiveChip(null)
    consumePending()
  }, [pending, consumePending])

  const applyFilterChip = (f: SavedFilterRow) => {
    if (activeChip === 'f' + f.id) { setFilter(emptyFilter()); setActiveChip(null); return }
    if (f.filterState) setFilter(f.filterState)
    if (f.sort) { const o = SORT_OPTIONS.find((s) => s.label === f.sort || s.short === f.sort); if (o) setSort(o) }
    setActiveList(null)
    setActiveChip('f' + f.id)
  }
  const applyListChip = (l: ReadingListRow) => {
    if (activeChip === 'l' + l.id) { setActiveList(null); setActiveChip(null); return }
    setActiveList(l)
    setActiveChip('l' + l.id)
  }
  const clearActive = () => { setActiveList(null); setActiveChip(null) }
  const activeName = activeChip
    ? (activeChip.startsWith('l') ? listChips.find((l) => 'l' + l.id === activeChip)?.name : quickFilters.find((f) => 'f' + f.id === activeChip)?.name)
    : null

  const rowV = useVirtualizer({
    count: results.length,
    getScrollElement: () => resultsRef.current,
    estimateSize: () => 240,
    overscan: 6,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    // Key measured heights by work, not by index — otherwise filtering/sorting (which
    // changes which work sits at each index) reuses the previous work's cached height
    // and cards overlap. Tying the cache to workId makes heights follow the card.
    getItemKey: (index) => results[index]?.workId ?? index,
  })

  const saveCurrentFilter = (name: string, starred: boolean) => {
    createSavedFilter(name, filter, sort.short, starred)
      .then((row) => { if (row.starred) setQuickFilters((prev) => [...prev, row]); setActiveChip('f' + row.id) })
      .catch((e) => alert(`Save failed: ${e instanceof Error ? e.message : e}`))
  }

  // Measure container width so default-open follows the viewport (open when docked).
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWide(e.contentRect.width >= DOCK_AT))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const panelOpen = userOpen ?? wide

  const toggleSelect = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className={'browse' + (panelOpen ? ' panel-open' : '') + (wide ? ' is-wide' : '')} ref={ref}>
      <header className="browse__header">
        <input className="browse__search" placeholder="Search title, author, summary…"
               value={query} onChange={(e) => setQuery(e.target.value)} />

        <div className="browse__tools">
          <BrowseRebuild />
          <div className="browse__sortwrap">
            <button className="browse__iconbtn" onClick={() => setSortMenu((o) => !o)} aria-haspopup="listbox" aria-expanded={sortMenu}>
              <SortIcon />
              <span className="browse__iconlabel">{sort.short}</span>
            </button>
            {sortMenu && (
              <>
                <div className="browse__menuscrim" onClick={() => setSortMenu(false)} />
                <ul className="browse__menu" role="listbox">
                  {SORT_OPTIONS.map((o) => (
                    <li key={o.label}>
                      <button
                        className={'browse__menuitem' + (o.label === sort.label ? ' is-on' : '')}
                        onClick={() => { setSort(o); setSortMenu(false) }}
                      >
                        {o.label}
                      </button>
                    </li>
                  ))}
                </ul>
              </>
            )}
          </div>

          <button
            className={'browse__iconbtn' + (panelOpen ? ' is-on' : '')}
            onClick={() => setUserOpen(!panelOpen)}
            aria-pressed={panelOpen}
            aria-label="Toggle filters"
          >
            <FunnelIcon />
            <span className="browse__iconlabel">Filters</span>
            {filterCount > 0 && <span className="browse__filtercount">{filterCount}</span>}
          </button>
        </div>
      </header>

      <div className="browse__body">
        <div className="browse__results" ref={resultsRef}>
          <div className="browse__starred">
            {listChips.map((l) => (
              <button
                key={'l' + l.id}
                className={'browse__starchip browse__starchip--list' + (activeChip === 'l' + l.id ? ' is-on' : '')}
                onClick={() => applyListChip(l)}
              >
                ★ {l.name}
              </button>
            ))}
            {quickFilters.map((f) => (
              <button
                key={'f' + f.id}
                className={'browse__starchip browse__starchip--filter' + (activeChip === 'f' + f.id ? ' is-on' : '')}
                onClick={() => applyFilterChip(f)}
              >
                <FunnelIcon /> {f.name}
              </button>
            ))}
          </div>

          {activeName && (
            <div className="browse__banner">
              Showing: <strong>“{activeName}”</strong>
              <button onClick={clearActive}>clear</button>
            </div>
          )}

          <div className="browse__count"><strong>{results.length.toLocaleString()}</strong> works · {sort.short}</div>

          {selected.size > 0 && (
            <div className="browse__bulk"><BulkBar count={selected.size} onClear={() => setSelected(new Set())} /></div>
          )}

          <div className="browse__list" ref={listRef}
               style={{ height: rowV.getTotalSize(), position: 'relative' }}>
            {rowV.getVirtualItems().map((vi) => {
              const w = withSeries(results[vi.index])
              return (
                <div key={w.workId} data-index={vi.index} ref={rowV.measureElement}
                     style={{ position: 'absolute', top: 0, left: 0, width: '100%',
                              paddingBottom: 'var(--space-3)',
                              transform: `translateY(${vi.start - rowV.options.scrollMargin}px)` }}>
                  <StoryCard work={w} selectable selected={selected.has(w.workId)}
                             onSelect={() => toggleSelect(w.workId)} onRead={() => setReaderWork(w)}
                             onFavorite={(v) => persist(w.workId, { isFavorite: v })}
                             onPin={(v) => persist(w.workId, { pinned: v })}
                             onStatus={(st) => persist(w.workId, { readStatus: st })}
                             onEditPrimary={() => setEditingWork(w)}
                             canAddToList />
                </div>
              )
            })}
          </div>
        </div>

        {/* Drawer scrim only when overlaying (narrow + open) */}
        {panelOpen && !wide && <div className="browse__scrim" onClick={() => setUserOpen(false)} />}
        <aside className={'browse__panel' + (panelOpen ? ' is-open' : '')} aria-hidden={!panelOpen}>
          <FilterPanel value={filter} onChange={setFilter} facets={facets} live={facetLive} onSaveFilter={saveCurrentFilter} onToggleTagFavorite={toggleTagFavorite}
            onClearAll={() => { setFilter(emptyFilter()); setQuery(''); clearActive() }}
            extraActive={query.trim().length > 0 || activeChip !== null} />
        </aside>
      </div>

      {readerWork && <Reader work={readerWork} onClose={() => setReaderWork(null)} />}
      {editingWork && (
        <PrimaryEditor
          work={editingWork}
          db={db}
          onClose={() => setEditingWork(null)}
          onSaved={(patch) => { patchLocal(editingWork.workId, patch); markSnapshotDirty(); setEditingWork(null) }}
        />
      )}
    </div>
  )
}

/* Apply pending curation (tag edits, primary-ship/collection edits) to Browse by
   rebuilding the snapshot, then reloading. Only appears when there are unapplied
   changes — so it's an explicit "push my edits live" affordance, not clutter. */
function BrowseRebuild() {
  const { reload } = useLibrary()
  const [dirty, setDirty] = useState(isSnapshotDirty())
  const [busy, setBusy] = useState(false)
  useEffect(() => onSnapshotDirtyChange(() => setDirty(isSnapshotDirty())), [])
  if (!dirty && !busy) return null
  const run = () => {
    setBusy(true)
    rebuildSnapshot().then(() => reload())
      .catch((e) => alert(`Rebuild failed: ${e instanceof Error ? e.message : e}`))
      .finally(() => setBusy(false))
  }
  return (
    <button className="browse__rebuild" onClick={run} disabled={busy}
            title="Apply your tag / primary edits to Browse (rebuild snapshot)">
      {busy ? 'Applying…' : '● Apply changes'}
    </button>
  )
}
