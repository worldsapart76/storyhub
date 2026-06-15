import './Badge.css'
import type { ReadStatus, Rating } from '../mock/data'

const STATUS_COLOR: Record<ReadStatus, string> = {
  Unread: 'var(--status-unread)',
  Read: 'var(--status-read)',
  DNF: 'var(--status-dnf)',
}

export function StatusBadge({ status }: { status: ReadStatus }) {
  return (
    <span className="badge badge--solid" style={{ background: STATUS_COLOR[status] }}>
      {status}
    </span>
  )
}

const RATING_COLOR: Record<Rating, string> = {
  General: 'var(--rating-general)',
  Teen: 'var(--rating-teen)',
  Mature: 'var(--rating-mature)',
  Explicit: 'var(--rating-explicit)',
  'Not Rated': 'var(--rating-notrated)',
}

const RATING_SHORT: Record<Rating, string> = {
  General: 'G', Teen: 'T', Mature: 'M', Explicit: 'E', 'Not Rated': 'NR',
}

/** Compact AO3 rating pip. `long` spells out the word (story-card detail). */
export function RatingBadge({ rating, long }: { rating: Rating; long?: boolean }) {
  return (
    <span className="badge badge--rating" style={{ background: RATING_COLOR[rating] }} title={rating}>
      {long ? rating : RATING_SHORT[rating]}
    </span>
  )
}

export function FavoriteStar({
  on,
  onClick,
}: {
  on: boolean
  onClick?: () => void
}) {
  return (
    <button
      className={'favstar' + (on ? ' is-on' : '')}
      aria-pressed={on}
      aria-label={on ? 'Favorited' : 'Mark favorite'}
      onClick={onClick}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

export function AvailabilityNote({ value }: { value: 'deleted' | 'locked' }) {
  return <span className={`avail avail--${value}`}>{value}</span>
}
