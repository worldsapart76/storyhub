import { useState } from 'react'
import './FilterPanel.css'
import { FilterChip, nextChipState, type ChipState } from './FilterChip'
import { CategoryBox } from './CategoryBox'
import { TAG_CATEGORIES, RATINGS, AUTHORS, WORDCOUNT_BUCKETS, type ReadStatus, type Rating } from '../mock/data'

const STATUSES: ReadStatus[] = ['Unread', 'Read', 'DNF']
const RATING_SHORT: Record<Rating, string> = { General: 'G', Teen: 'T', Mature: 'M', Explicit: 'E', 'Not Rated': 'NR' }

/* The Browse filter surface (browse.md). Docked on desktop / drawer on mobile —
   the parent (BrowseView) owns placement and the open/close toggle, so there's
   no close button here. Reading-list membership lives in the main Reading Lists
   surface, not here. Saved filters are CREATED here (Save filter, next to Clear
   all) — where the filters are live — and edited on the Saved Filters surface. */
export function FilterPanel({ onSaveFilter }: { onSaveFilter?: (name: string, starred: boolean) => void }) {
  const [status, setStatus] = useState<Record<string, ChipState>>({})
  const [rating, setRating] = useState<Record<string, ChipState>>({})
  const [favorite, setFavorite] = useState(false)
  const [buckets, setBuckets] = useState<Set<string>>(new Set()) // multi-select (OR)
  const [authorQuery, setAuthorQuery] = useState('')
  const [authors, setAuthors] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveStar, setSaveStar] = useState(true)

  const doSave = () => {
    const name = saveName.trim()
    if (!name) return
    onSaveFilter?.(name, saveStar)
    setSaving(false); setSaveName(''); setSaveStar(true)
  }

  const cycle = (set: typeof setStatus) => (name: string) =>
    set((p) => ({ ...p, [name]: nextChipState(p[name] ?? 'default') }))
  const toggleBucket = (b: string) =>
    setBuckets((prev) => {
      const next = new Set(prev)
      next.has(b) ? next.delete(b) : next.add(b)
      return next
    })

  const authorMatches = authorQuery.trim()
    ? AUTHORS.filter((a) => a.toLowerCase().includes(authorQuery.toLowerCase()) && !authors.includes(a)).slice(0, 6)
    : []

  return (
    <div className="fpanel">
      <header className="fpanel__head">
        <span className="fpanel__title">Filters</span>
        <div className="fpanel__headactions">
          <div className="fpanel__savewrap">
            <button className="fpanel__save" onClick={() => setSaving((s) => !s)} aria-expanded={saving}>Save filter</button>
            {saving && (
              <>
                <div className="fpanel__scrim" onClick={() => setSaving(false)} />
                <div className="fpanel__savepop" role="dialog" aria-label="Save current filters">
                  <div className="fpanel__saverow">
                    <button
                      className={'fpanel__savestar' + (saveStar ? ' is-on' : '')}
                      onClick={() => setSaveStar((s) => !s)}
                      role="switch"
                      aria-checked={saveStar}
                      title={saveStar ? 'Starred — shows as a Browse chip' : 'Star — show as a Browse chip'}
                    >{saveStar ? '★' : '☆'}</button>
                    <input
                      className="fpanel__saveinput"
                      autoFocus
                      placeholder="Filter name"
                      value={saveName}
                      onChange={(e) => setSaveName(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Enter') doSave(); if (e.key === 'Escape') setSaving(false) }}
                    />
                  </div>
                  <div className="fpanel__saveactions">
                    <button className="fpanel__savecancel" onClick={() => setSaving(false)}>Cancel</button>
                    <button className="fpanel__saveok" onClick={doSave} disabled={!saveName.trim()}>Save</button>
                  </div>
                </div>
              </>
            )}
          </div>
          <button className="fpanel__clear">Clear all</button>
        </div>
      </header>

      <div className="fpanel__scroll">
        {/* Condensed quick filters: label + chips on one row each */}
        <div className="fpanel__quick">
          <Row label="Status">
            {STATUSES.map((s) => (
              <FilterChip key={s} label={s} state={status[s] ?? 'default'} onCycle={() => cycle(setStatus)(s)} />
            ))}
            <button className={'fpanel__favtoggle' + (favorite ? ' is-on' : '')} aria-pressed={favorite} onClick={() => setFavorite((f) => !f)}>
              {favorite ? '★' : '☆'}
            </button>
          </Row>

          <Row label="Words">
            {WORDCOUNT_BUCKETS.map((b) => (
              <button key={b} className={'fpanel__bucket' + (buckets.has(b) ? ' is-on' : '')} onClick={() => toggleBucket(b)}>
                {b}
              </button>
            ))}
          </Row>

          <Row label="Rating">
            {RATINGS.map((r) => (
              <FilterChip key={r} label={RATING_SHORT[r]} state={rating[r] ?? 'default'} onCycle={() => cycle(setRating)(r)} />
            ))}
          </Row>
        </div>

        <div className="fpanel__divider" />

        {TAG_CATEGORIES.map(({ category, tags }) => (
          <CategoryBox key={category} category={category} tags={tags} defaultOpen={false} />
        ))}

        <div className="fpanel__divider" />

        {/* Precise / less-frequent refinements */}
        <Section title="Word count (precise)">
          <div className="fpanel__range">
            <input type="number" placeholder="Min" /> <span>–</span> <input type="number" placeholder="Max" />
          </div>
        </Section>

        <Section title="Dates">
          <div className="fpanel__daterange">
            <span className="fpanel__rangelabel">Read</span>
            <input type="date" aria-label="Read after" /> <span>–</span> <input type="date" aria-label="Read before" />
          </div>
          <div className="fpanel__daterange">
            <span className="fpanel__rangelabel">Added</span>
            <input type="date" aria-label="Added after" /> <span>–</span> <input type="date" aria-label="Added before" />
          </div>
        </Section>

        <Section title="Author">
          {authors.length > 0 && (
            <div className="fpanel__authorchips">
              {authors.map((a) => (
                <span key={a} className="fpanel__authorchip">
                  {a}
                  <button onClick={() => setAuthors((p) => p.filter((x) => x !== a))} aria-label={`Remove ${a}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <input className="fpanel__authorinput" placeholder="+ Add an author…" value={authorQuery} onChange={(e) => setAuthorQuery(e.target.value)} />
          {authorMatches.length > 0 && (
            <div className="fpanel__suggest">
              {authorMatches.map((a) => (
                <button key={a} className="fpanel__suggestitem" onClick={() => { setAuthors((p) => [...p, a]); setAuthorQuery('') }}>{a}</button>
              ))}
            </div>
          )}
        </Section>
      </div>
    </div>
  )
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="fpanel__row">
      <span className="fpanel__rowlabel">{label}</span>
      <div className="fpanel__rowchips">{children}</div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="fpanel__section">
      <div className="fpanel__sectitle">{title}</div>
      {children}
    </section>
  )
}
