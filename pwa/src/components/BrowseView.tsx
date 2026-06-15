import { useEffect, useRef, useState } from 'react'
import './BrowseView.css'
import { StoryCard } from './StoryCard'
import { FilterPanel } from './FilterPanel'
import { BulkBar } from './BulkBar'
import { Reader } from './Reader'
import { FunnelIcon, SortIcon } from './Icons'
import { BROWSE_RESULTS, SORT_OPTIONS, READING_LISTS_DATA, starredReadingLists, SAVED_FILTERS, type SavedFilter, type Work } from '../mock/data'

/* The quick-chip row holds two starred kinds, color-coded: reading LISTS (★, in
   the canonical Favorites-first/alphabetical order) and saved FILTERS (funnel
   glyph). Saved filters are CREATED here on Browse — where the filters are live —
   and only edited on the Saved Filters surface. */
const QUICK_LISTS = starredReadingLists(READING_LISTS_DATA)
const DOCK_AT = 880 // px: filter panel docks at/above this container width

/* The Browse surface (browse.md + §12.3). Search always visible; sort + filters
   are compact icon controls. The filter panel docks on the right when wide and
   is a slide-in drawer when narrow — one Filters button toggles it either way
   (open by default when docked). Result list virtualizes at Phase F. */
export function BrowseView() {
  const ref = useRef<HTMLDivElement>(null)
  const [wide, setWide] = useState(true)
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const [sort, setSort] = useState(SORT_OPTIONS[0])
  const [sortMenu, setSortMenu] = useState(false)
  const [activeFilter, setActiveFilter] = useState<string | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [readerWork, setReaderWork] = useState<Work | null>(null)
  const [savedFilters, setSavedFilters] = useState<SavedFilter[]>(SAVED_FILTERS)

  const quickFilters = savedFilters.filter((f) => f.starred)

  const saveCurrentFilter = (name: string, starred: boolean) => {
    const id = Math.max(0, ...savedFilters.map((f) => f.id)) + 1
    // Capture a representative snapshot of the live Browse state (mock).
    setSavedFilters((prev) => [...prev, {
      id, name, starred, sort: sort.short,
      terms: [{ label: 'MCU', kind: 'include' }, { label: 'Hurt/Comfort', kind: 'include' }, { label: 'Unread', kind: 'status' }],
    }])
    setActiveFilter(name)
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
    <div className={'browse' + (panelOpen ? ' panel-open' : '')} ref={ref}>
      <header className="browse__header">
        <input className="browse__search" placeholder="Search title, author, summary…" />

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
            <span className="browse__filtercount">3</span>
          </button>
        </div>
      </header>

      <div className="browse__body">
        <div className="browse__results">
          <div className="browse__starred">
            {QUICK_LISTS.map((l) => (
              <button
                key={'l' + l.id}
                className={'browse__starchip browse__starchip--list' + (activeFilter === l.name ? ' is-on' : '')}
                onClick={() => setActiveFilter(activeFilter === l.name ? null : l.name)}
              >
                ★ {l.name}
              </button>
            ))}
            {quickFilters.map((f) => (
              <button
                key={'f' + f.id}
                className={'browse__starchip browse__starchip--filter' + (activeFilter === f.name ? ' is-on' : '')}
                onClick={() => setActiveFilter(activeFilter === f.name ? null : f.name)}
              >
                <FunnelIcon /> {f.name}
              </button>
            ))}
          </div>

          {activeFilter && (
            <div className="browse__banner">
              Showing: <strong>“{activeFilter}”</strong>
              <button onClick={() => setActiveFilter(null)}>clear</button>
            </div>
          )}

          <div className="browse__count"><strong>1,284</strong> works · {sort.short}</div>

          {selected.size > 0 && (
            <div className="browse__bulk"><BulkBar count={selected.size} onClear={() => setSelected(new Set())} /></div>
          )}

          <div className="browse__list">
            {BROWSE_RESULTS.map((w) => (
              <StoryCard key={w.workId} work={w} selectable selected={selected.has(w.workId)} onSelect={() => toggleSelect(w.workId)} onRead={() => setReaderWork(w)} />
            ))}
          </div>
        </div>

        {/* Drawer scrim only when overlaying (narrow + open) */}
        {panelOpen && !wide && <div className="browse__scrim" onClick={() => setUserOpen(false)} />}
        <aside className={'browse__panel' + (panelOpen ? ' is-open' : '')} aria-hidden={!panelOpen}>
          <FilterPanel onSaveFilter={saveCurrentFilter} />
        </aside>
      </div>

      {readerWork && <Reader work={readerWork} onClose={() => setReaderWork(null)} />}
    </div>
  )
}
