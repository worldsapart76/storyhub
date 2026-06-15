import { useState } from 'react'
import './Kit.css'
import { StoryCard } from '../../components/StoryCard'
import { BulkBar } from '../../components/BulkBar'
import { WORKS } from '../../mock/data'

export function KitCard() {
  const [selected, setSelected] = useState<Set<number>>(new Set([WORKS[0].workId]))

  const toggle = (id: number) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <div className="kit">
      <h1 className="kit__h1">Story card</h1>
      <p className="kit__lede">
        The most-reused component — it sets the density for every result list. Switch to Phone to see it reflow.
      </p>

      <div className="kit__block">
        <div className="kit__label">Variants (realistic density)</div>
        <div className="kit__hint">
          1 — <b>“Born to Burn”</b> (from your screenshot): ~40 tags, 16 ch, multi-paragraph summary.
          Tap <b>“▾ Show full summary &amp; tags”</b> (or +N more) to reveal the whole summary and all tags
          <b> grouped by category</b>, ◇ = collapsed synonym group ·
          2 &amp; 3 — other dense works · 4 — <b>series</b>: tap 📚, then tap a sibling row to expand it into a full card ·
          5 — gen · 6 — DNF, poly ship, locked on AO3.
        </div>
        <div className="kit__stack">
          {WORKS.map((w) => (
            <StoryCard key={w.workId} work={w} />
          ))}
        </div>
      </div>

      <div className="kit__block">
        <div className="kit__label">Selectable + bulk bar</div>
        <div className="kit__hint">Multi-select state; the bulk bar appears with compact actions.</div>
        <div style={{ marginBottom: 'var(--space-3)' }}>
          <BulkBar count={selected.size} onClear={() => setSelected(new Set())} />
        </div>
        <div className="kit__stack">
          {WORKS.slice(0, 2).map((w) => (
            <StoryCard
              key={w.workId}
              work={w}
              selectable
              selected={selected.has(w.workId)}
              onSelect={() => toggle(w.workId)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}
