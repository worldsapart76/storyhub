import { useEffect, useState } from 'react'
import './ReviewQueue.css'
import { type Rating, fmtWords } from '../mock/data'
import {
  fetchReviewQueue,
  submitReview,
  type ReviewQueueItem,
} from '../data/review'
import { RatingBadge } from './Badge'
import { Button } from './Button'

/* Per-work Review Queue (pending-queue redesign, aligned to §6.3.1/§9/§12.6).

   The ONLY decision here is which of the work's own raw tags carries each primary
   role flag — default is the AO3 first-listed. An ambiguous capture (>1 fandom or
   >1 relationship) waits here until confirmed. NO grouping/synonym/category work
   happens here; that's Tag Management. Confirming APPROVES the capture (sets the
   primaries); the work itself commits from the Pending page's "Apply to Library". */

type RowState = {
  item: ReviewQueueItem
  fandomIdx: number
  shipIdx: number // -1 = gen (no relationship tag)
  status: 'open' | 'confirmed'
  error?: string
}

function initRow(item: ReviewQueueItem): RowState {
  const fandomIdx = Math.max(0, item.fandoms.findIndex((c) => c.tagId === item.defaultFandomTagId))
  const shipIdx = item.ships.length
    ? Math.max(0, item.ships.findIndex((c) => c.tagId === item.defaultShipTagId))
    : -1
  return { item, fandomIdx, shipIdx, status: 'open' }
}

export function ReviewQueue() {
  const [rows, setRows] = useState<RowState[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  function load() {
    setLoading(true)
    fetchReviewQueue()
      .then((items) => setRows(items.map(initRow)))
      .then(() => setLoadError(null))
      .catch((e) => setLoadError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }
  useEffect(load, [])

  const open = rows.filter((r) => r.status === 'open')
  const confirmed = rows.filter((r) => r.status === 'confirmed').length

  const patch = (id: string, fn: (r: RowState) => RowState) =>
    setRows((prev) => prev.map((r) => (r.item.queueItemId === id ? fn(r) : r)))

  async function commitRow(r: RowState): Promise<boolean> {
    const collectionTagId = r.item.fandoms[r.fandomIdx]?.tagId ?? null
    const shipTagId = r.shipIdx < 0 ? null : r.item.ships[r.shipIdx]?.tagId ?? null
    try {
      await submitReview(r.item.queueItemId, collectionTagId, shipTagId)
      patch(r.item.queueItemId, (x) => ({ ...x, status: 'confirmed', error: undefined }))
      return true
    } catch (e) {
      patch(r.item.queueItemId, (x) => ({ ...x, error: e instanceof Error ? e.message : String(e) }))
      return false
    }
  }

  async function confirmOne(r: RowState) {
    await commitRow(r)
  }

  async function confirmAll() {
    setBusy(true)
    for (const r of rows.filter((x) => x.status === 'open')) {
      // eslint-disable-next-line no-await-in-loop
      await commitRow(r)
    }
    setBusy(false)
  }

  return (
    <div className="rq">
      <header className="rq__head">
        <h1 className="rq__title">Review Queue</h1>
        <div className="rq__headactions">
          <Button variant="outline" size="md" disabled={busy || open.length === 0} onClick={confirmAll}>
            Confirm all{open.length ? ` · ${open.length}` : ''}
          </Button>
        </div>
      </header>

      {confirmed > 0 && (
        <div className="rq__status">
          <span className="rq__statok">✓ {confirmed} confirmed — apply on the Pending page</span>
        </div>
      )}

      {loading ? (
        <div className="rq__empty"><div className="rq__emptytitle">Loading…</div></div>
      ) : loadError ? (
        <div className="rq__empty">
          <div className="rq__emptyicon">⚠</div>
          <div className="rq__emptytitle">Couldn’t load the queue</div>
          <div className="rq__emptysub">{loadError}</div>
          <Button variant="outline" size="sm" onClick={load}>Retry</Button>
        </div>
      ) : open.length === 0 ? (
        <div className="rq__empty">
          <div className="rq__emptyicon">📥</div>
          <div className="rq__emptytitle">All caught up</div>
        </div>
      ) : (
        <ol className="rq__list">
          {open.map((r) => (
            <ReviewRow
              key={r.item.queueItemId}
              row={r}
              onFandom={(i) => patch(r.item.queueItemId, (x) => ({ ...x, fandomIdx: i }))}
              onShip={(i) => patch(r.item.queueItemId, (x) => ({ ...x, shipIdx: i }))}
              onConfirm={() => confirmOne(r)}
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
  const multiShip = item.ships.length > 1

  return (
    <li className="rq__row">
      <div className="rq__rowhead">
        <div className="rq__work">
          <span className="rq__worktitle">{item.title}</span>
          <span className="rq__byline">by {item.authors.join(', ') || 'Anonymous'}</span>
        </div>
        <div className="rq__workmeta">
          {item.rating && <RatingBadge rating={item.rating as Rating} />}
          <span className="rq__words">{fmtWords(item.wordcount)} words</span>
          <span className="rq__captured">{new Date(item.createdAt).toLocaleDateString()}</span>
          {multiFandom && <span className="rq__reason">{item.fandoms.length} fandoms</span>}
          {multiShip && <span className="rq__reason">{item.ships.length} ships</span>}
          {item.epubStaged ? (
            <span className="rq__epub rq__epub--ok" title="Epub uploaded to storage">epub ✓</span>
          ) : (
            <span className="rq__epub rq__epub--missing" title="The epub hasn’t reached storage. Committing won’t finish until it does — re-capture this work on AO3.">
              epub missing — re-capture
            </span>
          )}
        </div>
      </div>

      {item.summary && <p className="rq__summary">{item.summary}</p>}

      <div className="rq__primaries">
        <PrimaryAxis
          label="Primary fandom"
          options={item.fandoms.map((c) => c.name)}
          selected={row.fandomIdx}
          onSelect={onFandom}
        />
        <PrimaryAxis
          label="Primary ship"
          options={item.ships.map((c) => c.name)}
          selected={row.shipIdx}
          onSelect={onShip}
          emptyLabel="Gen — no ship"
        />
      </div>

      {row.error && <div className="rq__rowerror">⚠ {row.error}</div>}

      <div className="rq__actions">
        <Button variant="primary" size="sm" onClick={onConfirm}>Confirm primaries</Button>
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
