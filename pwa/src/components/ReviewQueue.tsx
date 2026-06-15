import { useState } from 'react'
import './ReviewQueue.css'
import { type ReviewItem, REVIEW_ITEMS, fmtWords } from '../mock/data'
import { RatingBadge } from './Badge'
import { Button } from './Button'

/* Per-work Review Queue (redesign §12.1, aligned to §6.3.1/§9/§12.6).

   The ONLY decision here is which of the work's own raw tags carries each primary
   role flag (work_tags.is_primary_ship / is_primary_collection) — default is the
   AO3 first-listed. A work lands here only when an axis is ambiguous (>1 fandom or
   >1 relationship). NO grouping/synonym/category work happens here; that's Tag
   Management (§12.6). The card later displays the flagged tag via its group. */

type RowState = {
  item: ReviewItem
  fandomIdx: number
  shipIdx: number       // -1 = gen (no relationship tag)
  status: 'open' | 'confirmed'
}

const initRow = (item: ReviewItem): RowState => ({
  item,
  fandomIdx: 0,
  shipIdx: item.relationships.length ? 0 : -1,
  status: 'open',
})

export function ReviewQueue() {
  const [rows, setRows] = useState<RowState[]>(REVIEW_ITEMS.map(initRow))

  const open = rows.filter((r) => r.status === 'open')
  const confirmed = rows.filter((r) => r.status === 'confirmed').length

  const patch = (id: string, fn: (r: RowState) => RowState) =>
    setRows((prev) => prev.map((r) => (r.item.queueId === id ? fn(r) : r)))

  const confirmAll = () =>
    setRows((prev) => prev.map((r) => (r.status === 'open' ? { ...r, status: 'confirmed' } : r)))

  return (
    <div className="rq">
      <header className="rq__head">
        <h1 className="rq__title">Review Queue</h1>
        <Button variant="outline" size="md" disabled={open.length === 0} onClick={confirmAll}>
          Confirm all{open.length ? ` · ${open.length}` : ''}
        </Button>
      </header>

      {confirmed > 0 && (
        <div className="rq__status">
          <span className="rq__statok">✓ {confirmed} committed</span>
        </div>
      )}

      {open.length === 0 ? (
        <div className="rq__empty">
          <div className="rq__emptyicon">📥</div>
          <div className="rq__emptytitle">All caught up</div>
        </div>
      ) : (
        <ol className="rq__list">
          {open.map((r) => (
            <ReviewRow
              key={r.item.queueId}
              row={r}
              onFandom={(i) => patch(r.item.queueId, (x) => ({ ...x, fandomIdx: i }))}
              onShip={(i) => patch(r.item.queueId, (x) => ({ ...x, shipIdx: i }))}
              onConfirm={() => patch(r.item.queueId, (x) => ({ ...x, status: 'confirmed' }))}
            />
          ))}
        </ol>
      )}
    </div>
  )
}

function ReviewRow({
  row, onFandom, onShip, onConfirm,
}: {
  row: RowState
  onFandom: (i: number) => void
  onShip: (i: number) => void
  onConfirm: () => void
}) {
  const { item } = row
  const multiFandom = item.fandoms.length > 1
  const multiShip = item.relationships.length > 1

  return (
    <li className="rq__row">
      <div className="rq__rowhead">
        <div className="rq__work">
          <span className="rq__worktitle">{item.title}</span>
          <span className="rq__byline">by {item.authors.join(', ')}</span>
        </div>
        <div className="rq__workmeta">
          <RatingBadge rating={item.rating} />
          <span className="rq__words">{fmtWords(item.wordcount)} words</span>
          <span className="rq__captured">{item.capturedAt}</span>
          {multiFandom && <span className="rq__reason">{item.fandoms.length} fandoms</span>}
          {multiShip && <span className="rq__reason">{item.relationships.length} ships</span>}
        </div>
      </div>

      <div className="rq__primaries">
        <PrimaryAxis
          label="Primary fandom"
          options={item.fandoms}
          selected={row.fandomIdx}
          onSelect={onFandom}
        />
        <PrimaryAxis
          label="Primary ship"
          options={item.relationships}
          selected={row.shipIdx}
          onSelect={onShip}
          emptyLabel="Gen — no ship"
        />
      </div>

      <div className="rq__actions">
        <Button variant="primary" size="sm" onClick={onConfirm}>Confirm &amp; commit</Button>
      </div>
    </li>
  )
}

/* One primary axis. >1 candidate → pick-one radio chips; exactly one → shown
   static (the forced default); zero (gen) → the empty label, static. */
function PrimaryAxis({
  label, options, selected, onSelect, emptyLabel,
}: {
  label: string
  options: string[]
  selected: number
  onSelect: (i: number) => void
  emptyLabel?: string
}) {
  if (options.length === 0) {
    return (
      <div className="pa">
        <div className="pa__label">{label}</div>
        <div className="pa__single pa__single--gen">{emptyLabel ?? '—'}</div>
      </div>
    )
  }
  if (options.length === 1) {
    return (
      <div className="pa">
        <div className="pa__label">{label}</div>
        <div className="pa__single">
          {options[0]}
          <span className="pa__only">only candidate</span>
        </div>
      </div>
    )
  }
  return (
    <div className="pa">
      <div className="pa__label">{label}</div>
      <div className="pa__opts" role="radiogroup" aria-label={label}>
        {options.map((o, i) => (
          <button
            key={o}
            className={'pa__opt' + (i === selected ? ' is-on' : '')}
            role="radio"
            aria-checked={i === selected}
            onClick={() => onSelect(i)}
          >
            <span className="pa__radio" aria-hidden>{i === selected ? '●' : '○'}</span>
            <span className="pa__optlabel">{o}</span>
            {i === 0 && <span className="pa__default">AO3 first</span>}
          </button>
        ))}
      </div>
    </div>
  )
}
