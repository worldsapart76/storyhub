import { useState } from 'react'
import './FilterPanel.css'
import { FilterChip, nextChipState } from './FilterChip'
import { CategoryBox } from './CategoryBox'
import {
  WORDCOUNT_BUCKETS, emptyCatFilter, activeCount,
  type CatFilter, type Facets, type FilterState,
} from '../data/filters'
import type { Rating, ReadStatus } from '../data/types'

const STATUSES: ReadStatus[] = ['Unread', 'Read', 'DNF']
const RATINGS: Rating[] = ['General', 'Teen', 'Mature', 'Explicit', 'Not Rated']
const RATING_SHORT: Record<Rating, string> = { General: 'G', Teen: 'T', Mature: 'M', Explicit: 'E', 'Not Rated': 'NR' }

/* The Browse filter surface (browse.md). Controlled by BrowseView: `value` is the
   live FilterState, `facets` are the real tag categories + authors derived from
   the loaded library. Docked on desktop / drawer on mobile — the parent owns
   placement and the open/close toggle, so there's no close button here. Saved
   filters are CREATED here (Save filter), edited on the Saved Filters surface. */
export function FilterPanel({
  value,
  onChange,
  facets,
  onSaveFilter,
}: {
  value: FilterState
  onChange: (next: FilterState) => void
  facets: Facets
  onSaveFilter?: (name: string, starred: boolean) => void
}) {
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const [saveStar, setSaveStar] = useState(true)
  const [authorQuery, setAuthorQuery] = useState('')

  const doSave = () => {
    const name = saveName.trim()
    if (!name) return
    onSaveFilter?.(name, saveStar)
    setSaving(false); setSaveName(''); setSaveStar(true)
  }

  const cycleStatus = (name: string) =>
    onChange({ ...value, status: { ...value.status, [name]: nextChipState(value.status[name] ?? 'default') } })
  const cycleRating = (name: string) =>
    onChange({ ...value, rating: { ...value.rating, [name]: nextChipState(value.rating[name] ?? 'default') } })
  const toggleBucket = (b: string) =>
    onChange({ ...value, buckets: value.buckets.includes(b) ? value.buckets.filter((x) => x !== b) : [...value.buckets, b] })
  const setCat = (category: string, next: CatFilter) =>
    onChange({ ...value, tags: { ...value.tags, [category]: next } })
  const addAuthor = (a: string) => {
    if (!value.authors.includes(a)) onChange({ ...value, authors: [...value.authors, a] })
    setAuthorQuery('')
  }
  const removeAuthor = (a: string) =>
    onChange({ ...value, authors: value.authors.filter((x) => x !== a) })

  const authorMatches = authorQuery.trim()
    ? facets.authors.filter((a) => a.toLowerCase().includes(authorQuery.toLowerCase()) && !value.authors.includes(a)).slice(0, 6)
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
          <button
            className="fpanel__clear"
            disabled={activeCount(value) === 0}
            onClick={() => onChange({ status: {}, favorite: false, rating: {}, buckets: [], wordMin: '', wordMax: '', tags: {}, authors: [] })}
          >Clear all</button>
        </div>
      </header>

      <div className="fpanel__scroll">
        {/* Condensed quick filters: label + chips on one row each */}
        <div className="fpanel__quick">
          <Row label="Status">
            {STATUSES.map((s) => (
              <FilterChip key={s} label={s} state={value.status[s] ?? 'default'} onCycle={() => cycleStatus(s)} />
            ))}
            <button
              className={'fpanel__favtoggle' + (value.favorite ? ' is-on' : '')}
              aria-pressed={value.favorite}
              onClick={() => onChange({ ...value, favorite: !value.favorite })}
            >
              {value.favorite ? '★' : '☆'}
            </button>
          </Row>

          <Row label="Words">
            {WORDCOUNT_BUCKETS.map((b) => (
              <button key={b} className={'fpanel__bucket' + (value.buckets.includes(b) ? ' is-on' : '')} onClick={() => toggleBucket(b)}>
                {b}
              </button>
            ))}
          </Row>

          <Row label="Rating">
            {RATINGS.map((r) => (
              <FilterChip key={r} label={RATING_SHORT[r]} state={value.rating[r] ?? 'default'} onCycle={() => cycleRating(r)} />
            ))}
          </Row>
        </div>

        <div className="fpanel__divider" />

        {facets.categories.map(({ category, tags }) => (
          <CategoryBox
            key={category}
            category={category}
            tags={tags}
            defaultOpen={false}
            value={value.tags[category] ?? emptyCatFilter()}
            onChange={(next) => setCat(category, next)}
          />
        ))}

        <div className="fpanel__divider" />

        {/* Precise / less-frequent refinements */}
        <Section title="Word count (precise)">
          <div className="fpanel__range">
            <input type="number" placeholder="Min" value={value.wordMin}
                   onChange={(e) => onChange({ ...value, wordMin: e.target.value })} />
            <span>–</span>
            <input type="number" placeholder="Max" value={value.wordMax}
                   onChange={(e) => onChange({ ...value, wordMax: e.target.value })} />
          </div>
        </Section>

        <Section title="Author">
          {value.authors.length > 0 && (
            <div className="fpanel__authorchips">
              {value.authors.map((a) => (
                <span key={a} className="fpanel__authorchip">
                  {a}
                  <button onClick={() => removeAuthor(a)} aria-label={`Remove ${a}`}>×</button>
                </span>
              ))}
            </div>
          )}
          <input className="fpanel__authorinput" placeholder="+ Add an author…" value={authorQuery} onChange={(e) => setAuthorQuery(e.target.value)} />
          {authorMatches.length > 0 && (
            <div className="fpanel__suggest">
              {authorMatches.map((a) => (
                <button key={a} className="fpanel__suggestitem" onClick={() => addAuthor(a)}>{a}</button>
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
