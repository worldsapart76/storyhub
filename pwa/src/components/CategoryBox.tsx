import { useMemo, useState } from 'react'
import './CategoryBox.css'
import { FilterChip, nextChipState, type ChipState } from './FilterChip'
import type { TagOption } from '../mock/data'
import type { CatFilter } from '../data/filters'

/* One Browse filter category (browse.md §7.3.2 + the favorite/search-to-add model).

   ALWAYS shows only FAVORITED tags by default (empty if none favorited) — mirrors
   the real library, where you curate which tags surface. SEARCH adds any other
   tag for THIS SESSION only (dashed, × to drop). ★ favorites a tag so it's
   always shown (Tag Management state=favorite). "Favorite" (not "pin") — a tag's
   favorite state, distinct from a WORK's offline pin.

   The HEADER toggles OR/AND (greens only). */

export function CategoryBox({
  category,
  tags,
  counts,
  defaultOpen = true,
  value,
  onChange,
}: {
  category: string
  tags: TagOption[]
  /* Co-occurrence-aware live counts (leave-one-out) for THIS category under the
     current selection. When present, chips show these counts and zero-match
     options are hidden (selected/active chips always stay). Omit to use each
     tag's global count and hide nothing (the gallery's uncontrolled mode). */
  counts?: Map<string, number>
  defaultOpen?: boolean
  /* Controlled mode (BrowseView): the include/exclude states + OR/AND mode are
     owned by the parent's FilterState. Favorites/session/search stay local
     (display concerns). Omit both to run uncontrolled — the gallery does. */
  value?: CatFilter
  onChange?: (next: CatFilter) => void
}) {
  const [open, setOpen] = useState(defaultOpen)
  const [localMode, setLocalMode] = useState<'OR' | 'AND'>('OR')
  const [query, setQuery] = useState('')
  const [localStates, setLocalStates] = useState<Record<string, ChipState>>({})
  const [favorites, setFavorites] = useState<Record<string, boolean>>(
    () => Object.fromEntries(tags.filter((t) => t.favorite).map((t) => [t.name, true])),
  )
  const [session, setSession] = useState<string[]>([]) // session-added tag names

  const controlled = !!onChange
  const states = controlled ? value?.states ?? {} : localStates
  const mode = controlled ? value?.mode ?? 'OR' : localMode

  const byName = useMemo(() => new Map(tags.map((t) => [t.name, t])), [tags])

  // Live (co-occurrence) count when provided, else the tag's global count.
  const liveCount = (name: string) => (counts ? counts.get(name) ?? 0 : byName.get(name)?.count ?? 0)

  // Visible = favorited (with a live match, unless active) + session-added + any
  // tag with an active state. Ranked by live count. When counts are present,
  // zero-match favorites are hidden so the box reflects the current selection.
  const visible = useMemo(() => {
    const lc = (n: string) => (counts ? counts.get(n) ?? 0 : byName.get(n)?.count ?? 0)
    const act = (n: string) => (states[n] ?? 'default') !== 'default'
    const favd = tags
      .filter((t) => favorites[t.name] && (!counts || lc(t.name) > 0 || act(t.name)))
      .sort((a, b) => lc(b.name) - lc(a.name) || a.name.localeCompare(b.name))
      .map((t) => t.name)
    const active = Object.entries(states).filter(([, s]) => s !== 'default').map(([n]) => n)
    const extra = [...session, ...active].filter((n, i, arr) => arr.indexOf(n) === i && !favd.includes(n))
    return [...favd, ...extra]
  }, [tags, favorites, session, states, counts, byName])

  const suggestions = useMemo(() => {
    if (!query.trim()) return []
    const q = query.toLowerCase()
    const visibleSet = new Set(visible)
    const lc = (n: string) => (counts ? counts.get(n) ?? 0 : byName.get(n)?.count ?? 0)
    return tags
      .filter((t) => t.name.toLowerCase().includes(q) && !visibleSet.has(t.name) && (!counts || lc(t.name) > 0))
      .sort((a, b) => lc(b.name) - lc(a.name) || a.name.localeCompare(b.name))
      .slice(0, 8)
  }, [query, tags, visible, counts, byName])

  const setStatesBoth = (updater: (p: Record<string, ChipState>) => Record<string, ChipState>) => {
    if (controlled) onChange!({ states: updater(states), mode })
    else setLocalStates(updater)
  }
  const setModeBoth = (m: 'OR' | 'AND') => {
    if (controlled) onChange!({ states, mode: m })
    else setLocalMode(m)
  }

  const cycle = (name: string) =>
    setStatesBoth((p) => ({ ...p, [name]: nextChipState(p[name] ?? 'default') }))
  const toggleFavorite = (name: string) => setFavorites((p) => ({ ...p, [name]: !p[name] }))
  const addSession = (name: string) => {
    // Searching + picking a tag means you want it ON — auto-include it (it stays
    // in the box if later unselected, until manually removed via × or a refresh).
    setSession((s) => (s.includes(name) ? s : [...s, name]))
    setStatesBoth((p) => ({ ...p, [name]: 'include' }))
    setQuery('')
  }
  const removeSession = (name: string) => {
    setSession((s) => s.filter((n) => n !== name))
    setStatesBoth((p) => ({ ...p, [name]: 'default' }))
  }

  const activeCount = Object.values(states).filter((s) => s !== 'default').length

  return (
    <section className="catbox">
      <header className="catbox__head">
        <button className="catbox__title" onClick={() => setOpen((o) => !o)}>
          <span className={'catbox__caret' + (open ? ' is-open' : '')}>▸</span>
          {category}
          {activeCount > 0 && <span className="catbox__activedot">{activeCount}</span>}
        </button>
        <button
          className={'catbox__mode catbox__mode--' + mode.toLowerCase()}
          onClick={() => setModeBoth(mode === 'OR' ? 'AND' : 'OR')}
          title={mode === 'OR' ? 'Any (OR) — tap for All (AND)' : 'All (AND) — tap for Any (OR)'}
        >
          {mode}
        </button>
      </header>

      {open && (
        <div className="catbox__body">
          {visible.length > 0 && (
            <div className="catbox__grid">
              {visible.map((name) => {
                const isFav = !!favorites[name]
                return (
                  <FilterChip
                    key={name}
                    label={name}
                    state={states[name] ?? 'default'}
                    count={liveCount(name)}
                    favorite={isFav}
                    temporary={!isFav}
                    onCycle={() => cycle(name)}
                    onFavorite={() => toggleFavorite(name)}
                    onRemove={!isFav ? () => removeSession(name) : undefined}
                  />
                )
              })}
            </div>
          )}

          <div className="catbox__search">
            <input
              className="catbox__searchinput"
              placeholder={visible.length === 0 ? `No favorites — search ${category.toLowerCase()}…` : `+ Add a ${category.toLowerCase()}…`}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            {suggestions.length > 0 && (
              <div className="catbox__suggest">
                {suggestions.map((s) => (
                  <button key={s.name} className="catbox__suggestitem" onClick={() => addSession(s.name)}>
                    <span className="catbox__suggestname">{s.name}</span>
                    <span className="catbox__suggestcount">{liveCount(s.name)}</span>
                  </button>
                ))}
              </div>
            )}
            {query.trim() && suggestions.length === 0 && (
              <div className="catbox__suggest catbox__suggest--empty">No more matches</div>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
