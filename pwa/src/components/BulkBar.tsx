import './BulkBar.css'
import { Button } from './Button'

/* Appears when results are multi-selected (browse.md "Bulk actions"). Compact
   labels; collapses overflow actions behind ⋯ on narrow containers. */

export function BulkBar({
  count,
  onClear,
}: {
  count: number
  onClear?: () => void
}) {
  if (count === 0) return null
  return (
    <div className="bulkbar" role="toolbar" aria-label="Bulk actions">
      <span className="bulkbar__count">{count} selected</span>
      <div className="bulkbar__actions">
        <Button size="sm" variant="secondary">+ List</Button>
        <Button size="sm" variant="secondary">Read</Button>
        <Button size="sm" variant="secondary">DNF</Button>
        <Button size="sm" variant="secondary">★ Favorite</Button>
        <Button size="sm" variant="secondary">📌 Pin</Button>
      </div>
      <button className="bulkbar__clear" onClick={onClear} aria-label="Clear selection">✕</button>
    </div>
  )
}
