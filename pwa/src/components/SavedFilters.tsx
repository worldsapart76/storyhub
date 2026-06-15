import { useMemo, useState } from 'react'
import './SavedFilters.css'
import { SAVED_FILTERS, type SavedFilter, type FilterTerm } from '../mock/data'
import { Button } from './Button'

/* Saved Filters (redesign §12.6 / docs/ux/saved-filters.md). Named presets of
   Browse filter + sort state, re-evaluated live.
   - STARRED filters sort to the top (and become Browse quick chips); the rest
     are alphabetical — same ordering rule as Reading Lists.
   - On load, any stored term that no longer resolves (e.g. a raw tag that since
     folded into a group) is re-validated and VISIBLY FLAGGED — never silently
     dropped. "Update" rewrites the term to the resolved group.
   - Apply loads Browse with the saved state (here it just marks the row).
   The Modified-from / Save-as flow lives on Browse (post-apply) — not this
   management surface. */

const KIND_CLASS: Record<FilterTerm['kind'], string> = {
  include: 'sf__term--include', exclude: 'sf__term--exclude',
  status: 'sf__term--meta', words: 'sf__term--meta', rating: 'sf__term--meta',
  date: 'sf__term--meta', author: 'sf__term--meta', list: 'sf__term--meta',
}

export function SavedFilters() {
  const [filters, setFilters] = useState<SavedFilter[]>(SAVED_FILTERS)
  const [appliedId, setAppliedId] = useState<number | null>(null)
  const [editId, setEditId] = useState<number | null>(null)
  const [menuId, setMenuId] = useState<number | null>(null)

  // Starred sort to the top, then alphabetical — same rule as Reading Lists.
  const ordered = useMemo(
    () => [...filters].sort((a, b) => (a.starred !== b.starred ? (a.starred ? -1 : 1) : a.name.localeCompare(b.name))),
    [filters],
  )

  const update = (id: number, fn: (f: SavedFilter) => SavedFilter) =>
    setFilters((prev) => prev.map((f) => (f.id === id ? fn(f) : f)))
  const toggleStar = (id: number) => update(id, (f) => ({ ...f, starred: !f.starred }))
  const rename = (id: number, v: string) => { const n = v.trim(); if (n) update(id, (f) => ({ ...f, name: n })); setEditId(null) }
  const remove = (id: number) => setFilters((prev) => prev.filter((f) => f.id !== id))
  const acceptRevalidate = (id: number) =>
    update(id, (f) => ({
      ...f,
      terms: f.terms.map((t) => (t.stale ? { ...t, label: t.resolvesTo ?? t.label, stale: false, resolvesTo: undefined } : t)),
    }))

  return (
    <div className="sf">
      <header className="sf__head">
        <h1 className="sf__title">Saved Filters</h1>
      </header>

      <ol className="sf__list">
        {ordered.map((f) => {
          const staleCount = f.terms.filter((t) => t.stale).length
          return (
            <li
              key={f.id}
              className={'sf__row' + (appliedId === f.id ? ' is-applied' : '')}
            >
              <button
                className={'sf__star' + (f.starred ? ' is-on' : '')}
                onClick={() => toggleStar(f.id)}
                role="switch"
                aria-checked={f.starred}
                title={f.starred ? 'Starred — shown as a Browse chip' : 'Star — show as a Browse chip'}
              >{f.starred ? '★' : '☆'}</button>

              <div className="sf__body">
                <div className="sf__rowtop">
                  {editId === f.id ? (
                    <input className="sf__nameinput" defaultValue={f.name} autoFocus
                      onBlur={(e) => rename(f.id, e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') rename(f.id, e.currentTarget.value); if (e.key === 'Escape') setEditId(null) }} />
                  ) : (
                    <button className="sf__name" onClick={() => setEditId(f.id)} title="Click to rename">{f.name}</button>
                  )}
                  <span className="sf__sort">{f.sort}</span>
                  {staleCount > 0 && (
                    <span className="sf__revalidate">
                      <span className="sf__warn" aria-hidden>⚠</span>
                      {staleCount} re-validated
                      <button className="sf__revbtn" onClick={() => acceptRevalidate(f.id)}>Update</button>
                    </span>
                  )}
                </div>

                <div className="sf__terms">
                  {f.terms.map((t, i) => (
                    <span key={i} className={'sf__term ' + KIND_CLASS[t.kind] + (t.stale ? ' is-stale' : '')}
                      title={t.stale ? `“${t.label}” now resolves to the “${t.resolvesTo}” group` : undefined}>
                      {t.kind === 'include' && <span className="sf__termmark" aria-hidden>+</span>}
                      {t.kind === 'exclude' && <span className="sf__termmark" aria-hidden>−</span>}
                      {t.label}
                      {t.stale && t.resolvesTo && <span className="sf__resolves">→ {t.resolvesTo}</span>}
                    </span>
                  ))}
                </div>
              </div>

              <div className="sf__rowactions">
                <Button variant={appliedId === f.id ? 'secondary' : 'outline'} size="sm" onClick={() => setAppliedId(f.id)}>
                  {appliedId === f.id ? '✓ Applied' : 'Apply'}
                </Button>
                <div className="sf__menuwrap">
                  <button className="sf__kebab" onClick={() => setMenuId((m) => (m === f.id ? null : f.id))} aria-label="More actions" aria-expanded={menuId === f.id}>⋯</button>
                  {menuId === f.id && (
                    <>
                      <div className="sf__scrim" onClick={() => setMenuId(null)} />
                      <ul className="sf__menu" role="menu">
                        <li><button className="sf__menuitem" onClick={() => { setEditId(f.id); setMenuId(null) }}>Rename</button></li>
                        <li><button className="sf__menuitem" onClick={() => setMenuId(null)}>Snapshot to Reading List</button></li>
                        <li><button className="sf__menuitem" onClick={() => setMenuId(null)}>Duplicate</button></li>
                        <li><button className="sf__menuitem sf__menuitem--danger" onClick={() => { remove(f.id); setMenuId(null) }}>Delete</button></li>
                      </ul>
                    </>
                  )}
                </div>
              </div>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
