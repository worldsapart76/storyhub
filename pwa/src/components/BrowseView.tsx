import { useEffect, useMemo, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import './BrowseView.css'
import { StoryCard } from './StoryCard'
import { FilterPanel } from './FilterPanel'
import { BulkBar } from './BulkBar'
import { Reader } from './Reader'
import { FunnelIcon, SortIcon } from './Icons'
import { SORT_OPTIONS } from '../mock/data'
import { useLibrary } from '../data/library'
import { useNav } from '../data/appnav'
import { applyFilters, buildFacets, emptyFilter, activeCount, type FilterState } from '../data/filters'
import { createSavedFilter, fetchReadingLists, fetchSavedFilters, type ReadingListRow, type SavedFilterRow } from '../data/lists'
import { fetchFavoriteTagNames } from '../data/tags'
import type { Work } from '../data/types'

/* Sort comparators keyed by SORT_OPTIONS.label. Dates compare on raw epoch-ms
   (the dateAdded/dateRead strings are display-formatted — never compare those). */
function comparator(label: string): (a: Work, b: Work) => number {
  switch (label) {
    case 'Date added — newest': return (a, b) => (b.dateAddedTs ?? 0) - (a.dateAddedTs ?? 0)
    case 'Date added — oldest': return (a, b) => (a.dateAddedTs ?? 0) - (b.dateAddedTs ?? 0)
    case 'Date read — newest': return (a, b) => (b.dateReadTs ?? 0) - (a.dateReadTs ?? 0)
    case 'Word count — high to low': return (a, b) => b.wordcount - a.wordcount
    case 'Word count — low to high': return (a, b) => a.wordcount - b.wordcount
    case 'Title — A to Z': return (a, b) => a.title.localeCompare(b.title)
    case 'Author — A to Z': return (a, b) => (a.authors[0] ?? '').localeCompare(b.authors[0] ?? '')
    default: return () => 0
  }
}

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
  const [sort, setSort] = useState(SORT_OPTIONS[0])
  const [sortMenu, setSortMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [readerWork, setReaderWork] = useState<Work | null>(null)
  const [filter, setFilter] = useState<FilterState>(emptyFilter)
  const [quickLists, setQuickLists] = useState<ReadingListRow[]>([])
  const [quickFilters, setQuickFilters] = useState<SavedFilterRow[]>([])
  const [activeList, setActiveList] = useState<ReadingListRow | null>(null)
  const [activeChip, setActiveChip] = useState<string | null>(null)
  const [favTags, setFavTags] = useState<Set<string>>(new Set())

  const { works, update } = useLibrary()
  const { pending, consumePending } = useNav()
  const persist = (workId: number, edit: Parameters<typeof update>[1]) =>
    update(workId, edit).then((err) => { if (err) alert(`Save failed: ${err}`) })
  const facets = useMemo(() => buildFacets(works, favTags), [works, favTags])

  // Favorites is a client-synthesized system list; the rest are starred API lists.
  const favoriteIds = useMemo(() => works.filter((w) => w.isFavorite).map((w) => w.workId), [works])
  const listChips: ReadingListRow[] = useMemo(() => [
    { id: 'favorites', name: 'Favorites', description: null, color: null, autoPin: false, isSystem: true, starred: true, memberIds: favoriteIds },
    ...quickLists.filter((l) => !l.isSystem),
  ], [quickLists, favoriteIds])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    let base = works
    if (activeList) {
      const member = new Set(activeList.memberIds)
      base = base.filter((w) => member.has(w.workId))
    }
    const searched = q
      ? base.filter((w) =>
          w.title.toLowerCase().includes(q) ||
          w.authors.some((a) => a.toLowerCase().includes(q)) ||
          w.summary.toLowerCase().includes(q) ||
          (w.primaryShip ?? '').toLowerCase().includes(q))
      : base
    return [...applyFilters(searched, filter)].sort(comparator(sort.label))
  }, [works, query, sort, filter, activeList])

  const filterCount = activeCount(filter)

  // Load the starred quick-chips (lists + filters) and favorited tags live.
  useEffect(() => {
    fetchReadingLists().then((ls) => setQuickLists(ls.filter((l) => l.starred))).catch(() => {})
    fetchSavedFilters().then((fs) => setQuickFilters(fs.filter((f) => f.starred))).catch(() => {})
    fetchFavoriteTagNames().then(setFavTags).catch(() => {})
  }, [])

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
              const w = results[vi.index]
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
                             canAddToList />
                </div>
              )
            })}
          </div>
        </div>

        {/* Drawer scrim only when overlaying (narrow + open) */}
        {panelOpen && !wide && <div className="browse__scrim" onClick={() => setUserOpen(false)} />}
        <aside className={'browse__panel' + (panelOpen ? ' is-open' : '')} aria-hidden={!panelOpen}>
          <FilterPanel value={filter} onChange={setFilter} facets={facets} onSaveFilter={saveCurrentFilter} />
        </aside>
      </div>

      {readerWork && <Reader work={readerWork} onClose={() => setReaderWork(null)} />}
    </div>
  )
}
