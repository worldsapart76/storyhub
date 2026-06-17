import { useEffect, useMemo, useState } from 'react'
import './SavedFilters.css'
import { Button } from './Button'
import { useNav } from '../data/appnav'
import {
  deleteSavedFilter, fetchSavedFilters, patchSavedFilter,
  summarizeFilter, type SavedFilterRow,
} from '../data/lists'

/* Saved Filters (redesign §12.6 / docs/ux/saved-filters.md). Named presets of
   Browse filter + sort state, read live from the hub. Starred filters sort to the
   top (and surface as Browse quick-chips); the rest alphabetical. Apply loads the
   saved state onto Browse. Filters are CREATED on Browse (Save filter), not here.
   Stale-term re-validation is deferred (needs synonym/group resolution). */

const KIND_CLASS: Record<string, string> = {
  include: 'sf__term--include', exclude: 'sf__term--exclude', meta: 'sf__term--meta',
}

export function SavedFilters() {
  const { applyFilterToBrowse } = useNav()
  const [filters, setFilters] = useState<SavedFilterRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editId, setEditId] = useState<string | null>(null)
  const [menuId, setMenuId] = useState<string | null>(null)

  useEffect(() => {
    fetchSavedFilters()
      .then((rows) => setFilters(rows))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const ordered = useMemo(
    () => [...filters].sort((a, b) => (a.starred !== b.starred ? (a.starred ? -1 : 1) : a.name.localeCompare(b.name))),
    [filters],
  )

  const replace = (row: SavedFilterRow) => setFilters((prev) => prev.map((f) => (f.id === row.id ? row : f)))
  const toggleStar = (f: SavedFilterRow) => patchSavedFilter(f.id, { starred: !f.starred }).then(replace).catch(reportErr)
  const rename = (f: SavedFilterRow, v: string) => {
    const n = v.trim(); setEditId(null)
    if (n && n !== f.name) patchSavedFilter(f.id, { name: n }).then(replace).catch(reportErr)
  }
  const remove = (f: SavedFilterRow) => {
    setFilters((prev) => prev.filter((x) => x.id !== f.id))
    deleteSavedFilter(f.id).catch(reportErr)
  }
  const apply = (f: SavedFilterRow) => { if (f.filterState) applyFilterToBrowse(f.filterState, f.sort ?? undefined) }

  if (loading) return <div className="sf"><header className="sf__head"><h1 className="sf__title">Saved Filters</h1></header><p style={pad}>Loading…</p></div>
  if (error) return <div className="sf"><header className="sf__head"><h1 className="sf__title">Saved Filters</h1></header><p style={pad}>Couldn’t load: {error}</p></div>

  return (
    <div className="sf">
      <header className="sf__head">
        <h1 className="sf__title">Saved Filters</h1>
      </header>

      {ordered.length === 0 ? (
        <p style={pad}>None yet. Build a filter on Browse, then “Save filter”.</p>
      ) : (
        <ol className="sf__list">
          {ordered.map((f) => {
            const terms = summarizeFilter(f.filterState)
            return (
              <li key={f.id} className="sf__row">
                <button
                  className={'sf__star' + (f.starred ? ' is-on' : '')}
                  onClick={() => toggleStar(f)}
                  role="switch"
                  aria-checked={f.starred}
                  title={f.starred ? 'Starred — shown as a Browse chip' : 'Star — show as a Browse chip'}
                >{f.starred ? '★' : '☆'}</button>

                <div className="sf__body">
                  <div className="sf__rowtop">
                    {editId === f.id ? (
                      <input className="sf__nameinput" defaultValue={f.name} autoFocus
                        onBlur={(e) => rename(f, e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') rename(f, e.currentTarget.value); if (e.key === 'Escape') setEditId(null) }} />
                    ) : (
                      <button className="sf__name" onClick={() => setEditId(f.id)} title="Click to rename">{f.name}</button>
                    )}
                    {f.sort && <span className="sf__sort">{f.sort}</span>}
                  </div>

                  <div className="sf__terms">
                    {terms.length === 0 && <span className="sf__term sf__term--meta">(no active terms)</span>}
                    {terms.map((t, i) => (
                      <span key={i} className={'sf__term ' + KIND_CLASS[t.kind]}>
                        {t.kind === 'include' && <span className="sf__termmark" aria-hidden>+</span>}
                        {t.kind === 'exclude' && <span className="sf__termmark" aria-hidden>−</span>}
                        {t.label}
                      </span>
                    ))}
                  </div>
                </div>

                <div className="sf__rowactions">
                  <Button variant="outline" size="sm" onClick={() => apply(f)} disabled={!f.filterState}>Apply</Button>
                  <div className="sf__menuwrap">
                    <button className="sf__kebab" onClick={() => setMenuId((m) => (m === f.id ? null : f.id))} aria-label="More actions" aria-expanded={menuId === f.id}>⋯</button>
                    {menuId === f.id && (
                      <>
                        <div className="sf__scrim" onClick={() => setMenuId(null)} />
                        <ul className="sf__menu" role="menu">
                          <li><button className="sf__menuitem" onClick={() => { setEditId(f.id); setMenuId(null) }}>Rename</button></li>
                          <li><button className="sf__menuitem sf__menuitem--danger" onClick={() => { remove(f); setMenuId(null) }}>Delete</button></li>
                        </ul>
                      </>
                    )}
                  </div>
                </div>
              </li>
            )
          })}
        </ol>
      )}
    </div>
  )
}

const pad: React.CSSProperties = { padding: 'var(--space-4)', color: 'var(--text-muted)' }
function reportErr(e: unknown) { alert(`Save failed: ${e instanceof Error ? e.message : e}`) }
