import './StatusCluster.css'
import type { ReadStatus } from '../mock/data'

/* The status/favorite control cluster reused on cards and the reading flow.
   read_status is a segmented Unread|Read|DNF; Favorite ★ is an orthogonal
   toggle (redesign §8/§12.2). Compact mode drops to icons for the card. */

const STATUSES: ReadStatus[] = ['Unread', 'Read', 'DNF']

export function StatusCluster({
  status,
  favorite = false,
  compact,
  hideFavorite,
  onStatus,
  onFavorite,
}: {
  status: ReadStatus
  favorite?: boolean
  compact?: boolean
  hideFavorite?: boolean
  onStatus?: (s: ReadStatus) => void
  onFavorite?: () => void
}) {
  return (
    <div className={'statuscluster' + (compact ? ' is-compact' : '')}>
      <div className="statuscluster__seg" role="group" aria-label="Read status">
        {STATUSES.map((s) => (
          <button
            key={s}
            className={'statuscluster__seg-btn' + (s === status ? ' is-on' : '')}
            onClick={() => onStatus?.(s)}
          >
            {s}
          </button>
        ))}
      </div>
      {!hideFavorite && (
        <button
          className={'statuscluster__fav' + (favorite ? ' is-on' : '')}
          aria-pressed={favorite}
          onClick={onFavorite}
          title="Favorite (private bookmark on AO3)"
        >
          {favorite ? '★' : '☆'}
          {!compact && <span>Favorite</span>}
        </button>
      )}
    </div>
  )
}
