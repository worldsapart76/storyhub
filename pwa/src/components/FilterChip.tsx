import './FilterChip.css'

export type ChipState = 'default' | 'include' | 'exclude'

/** Three-tap include / exclude / clear chip (browse.md). default → include →
    exclude → default. Optional affordances:
      - favorite/onFavorite : a ★ that favorites the tag so it's always shown in
                              its category box (Tag Management state=favorite).
                              NOTE: distinct from a WORK's offline "pin".
      - temporary           : dashed outline — a session-only tag added via search
      - onRemove            : an × to drop a session tag for this session
      - grouped             : ◇ marks a collapsed synonym/group chip (§6.3.1) */
export function FilterChip({
  label,
  state,
  count,
  grouped,
  favorite,
  temporary,
  onCycle,
  onFavorite,
  onRemove,
}: {
  label: string
  state: ChipState
  count?: number
  grouped?: boolean
  favorite?: boolean
  temporary?: boolean
  onCycle?: () => void
  onFavorite?: () => void
  onRemove?: () => void
}) {
  const stop = (e: React.MouseEvent, fn?: () => void) => {
    e.stopPropagation()
    fn?.()
  }
  return (
    <span className={`chip chip--${state}` + (grouped ? ' chip--grouped' : '') + (temporary ? ' chip--temp' : '')}>
      <button className="chip__body" onClick={onCycle} aria-pressed={state !== 'default'} title={grouped ? `${label} (group)` : label}>
        {grouped && <span className="chip__groupmark" aria-hidden>◇</span>}
        <span className="chip__label">{label}</span>
        {count !== undefined && <span className="chip__count">{count}</span>}
      </button>
      {favorite !== undefined && (
        <button
          className={'chip__fav' + (favorite ? ' is-on' : '')}
          onClick={(e) => stop(e, onFavorite)}
          title={favorite ? 'Favorited — always shown in this box' : 'Favorite this tag'}
          aria-label={favorite ? 'Unfavorite tag' : 'Favorite tag'}
        >
          {favorite ? '★' : '☆'}
        </button>
      )}
      {onRemove && !favorite && (
        <button className="chip__remove" onClick={(e) => stop(e, onRemove)} title="Remove for this session" aria-label="Remove tag">
          ×
        </button>
      )}
    </span>
  )
}

export function nextChipState(s: ChipState): ChipState {
  return s === 'default' ? 'include' : s === 'include' ? 'exclude' : 'default'
}
