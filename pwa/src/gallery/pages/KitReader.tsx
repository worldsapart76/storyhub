import { useState } from 'react'
import { Reader } from '../../components/Reader'
import { WORKS } from '../../mock/data'

/* Standalone demo of the in-app reader (§5 fallback) so its typography and
   reading controls can be reviewed directly. In the app it launches from a
   card's "Read here" action (see the Browse surface). */
export function KitReader() {
  const [open, setOpen] = useState(true)
  const work = WORKS.find((w) => w.chapterCount) ?? WORKS[0]

  return (
    <div style={{ position: 'relative', height: '100%', minHeight: 0, background: 'var(--bg)' }}>
      {open ? (
        <Reader work={work} onClose={() => setOpen(false)} />
      ) : (
        <div style={{ display: 'grid', placeItems: 'center', height: '100%', gap: 'var(--space-3)' }}>
          <div style={{ color: 'var(--text-secondary)', fontSize: 'var(--text-sm)' }}>Reader closed.</div>
          <button className="btn btn--primary btn--md" onClick={() => setOpen(true)}>Read here</button>
        </div>
      )}
    </div>
  )
}
