import { useState } from 'react'
import './Kit.css'
import { Button } from '../../components/Button'
import { StatusBadge, RatingBadge, FavoriteStar } from '../../components/Badge'
import { FilterChip, nextChipState, type ChipState } from '../../components/FilterChip'
import { StatusCluster } from '../../components/StatusCluster'
import { CategoryBox } from '../../components/CategoryBox'
import { MOOD_TAGS, RELATIONSHIP_TAGS, type ReadStatus } from '../../mock/data'

export function KitElements() {
  return (
    <div className="kit">
      <h1 className="kit__h1">Elements</h1>
      <p className="kit__lede">The small building blocks. All token-driven — flip Theme / Viewport in the toolbar.</p>

      <Block label="Buttons" hint="primary = the one main action; secondary = supporting; ghost = low-emphasis; danger = destructive.">
        <div className="kit__row">
          <Button variant="primary">Save filter</Button>
          <Button variant="secondary">Add to list</Button>
          <Button variant="ghost">Cancel</Button>
          <Button variant="danger">Delete</Button>
          <Button variant="primary" size="sm">Small</Button>
        </div>
      </Block>

      <Block label="Rating pips" hint="Compact by default (G/T/M/E/NR); long form on detail surfaces. AO3 colors.">
        <div className="kit__row">
          <RatingBadge rating="General" /><RatingBadge rating="Teen" /><RatingBadge rating="Mature" />
          <RatingBadge rating="Explicit" /><RatingBadge rating="Not Rated" />
          <span style={{ width: 12 }} />
          <RatingBadge rating="Mature" long /><RatingBadge rating="Explicit" long />
        </div>
      </Block>

      <Block label="Status badge & favorite" hint="read_status (Unread/Read/DNF) + the orthogonal ★.">
        <div className="kit__row">
          <StatusBadge status="Unread" /><StatusBadge status="Read" /><StatusBadge status="DNF" />
          <span style={{ width: 12 }} />
          <FavStarDemo />
        </div>
      </Block>

      <Block label="Filter chip — tri-state" hint="Tap the body to cycle: default → include (green) → exclude (red) → default. ◇ = collapsed synonym/group. ★ favorites the tag (always shown in its box); dashed = session-only (× to drop).">
        <div className="kit__row">
          <ChipDemo label="Slow Burn" />
          <ChipDemo label="Found Family" />
          <ChipDemo label="Bucky/Clint" grouped />
          <FilterChip label="Angst" state="default" count={412} />
          <FilterChip label="Fluff" state="include" count={88} />
          <FavChipDemo label="Hurt/Comfort" count={2890} startFav />
          <FavChipDemo label="Catharsis" count={210} temporary />
        </div>
      </Block>

      <Block label="Status cluster" hint="The reusable status/favorite control (card + reading flow). Full and compact forms.">
        <div className="kit__col">
          <ClusterDemo />
          <ClusterDemo compact />
        </div>
      </Block>

      <Block
        label="Category box (favorites-only + search-to-add)"
        hint="Only FAVORITED (★) tags show by default — same for every category, big or small (empty if none favorited). Type in '+ Add a relationship…' (try 'harry', 'wei', 'cas') to surface any other tag and add it for this session (dashed). ★ favorites it (always shown); × drops it. Header toggles OR/AND."
      >
        <div style={{ maxWidth: 360, display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          <CategoryBox category="Relationship" tags={RELATIONSHIP_TAGS} />
          <CategoryBox category="Mood" tags={MOOD_TAGS} />
        </div>
      </Block>
    </div>
  )
}

function FavChipDemo({ label, count, startFav, temporary }: { label: string; count: number; startFav?: boolean; temporary?: boolean }) {
  const [state, setState] = useState<ChipState>('default')
  const [fav, setFav] = useState(!!startFav)
  return (
    <FilterChip
      label={label}
      state={state}
      count={count}
      favorite={fav}
      temporary={temporary && !fav}
      onCycle={() => setState(nextChipState(state))}
      onFavorite={() => setFav((f) => !f)}
    />
  )
}

function Block({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="kit__block">
      <div className="kit__label">{label}</div>
      {hint && <div className="kit__hint">{hint}</div>}
      {children}
    </div>
  )
}

function ChipDemo({ label, grouped }: { label: string; grouped?: boolean }) {
  const [state, setState] = useState<ChipState>('default')
  return <FilterChip label={label} state={state} grouped={grouped} onCycle={() => setState(nextChipState(state))} />
}

function FavStarDemo() {
  const [on, setOn] = useState(true)
  return <FavoriteStar on={on} onClick={() => setOn((v) => !v)} />
}

function ClusterDemo({ compact }: { compact?: boolean }) {
  const [status, setStatus] = useState<ReadStatus>('Unread')
  const [fav, setFav] = useState(false)
  return <StatusCluster status={status} favorite={fav} compact={compact} onStatus={setStatus} onFavorite={() => setFav((v) => !v)} />
}
