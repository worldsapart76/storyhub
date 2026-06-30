import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import './PrimaryEditor.css'
import type { Database } from 'sql.js'
import type { Work } from '../data/types'
import { collectionDisplay, readPrimaryInfo, resolveDisplay, setPrimaries } from '../data/primaries'
import { Button } from './Button'

/* Per-work primary ship / collection editor (Browse). Mirrors the Review Queue's
   picker but for a committed work: choose which of the work's own relationship tag is
   the primary ship and which fandom is the primary collection. Candidates + optimistic
   labels come from the snapshot (data/primaries); the write hits the hub and shows in
   Browse after a rebuild — the parent updates the card immediately and marks dirty. */
export function PrimaryEditor({ work, db, onClose, onSaved }: {
  work: Work
  db: Database | null
  onClose: () => void
  onSaved: (patch: { primaryShip: string | null; primaryCollection: string | null }) => void
}) {
  const info = useMemo(() => readPrimaryInfo(db, work.workId), [db, work.workId])
  const [ship, setShip] = useState<number | null>(info.currentShipTagId)
  const [coll, setColl] = useState<number | null>(info.currentCollectionTagId)
  const [busy, setBusy] = useState(false)

  const save = () => {
    setBusy(true)
    setPrimaries(work.workId, ship, coll)
      .then(() => onSaved({
        primaryShip: ship == null ? null : resolveDisplay(db, ship),
        primaryCollection: coll == null ? null : collectionDisplay(db, coll),
      }))
      .catch((e) => { alert(`Save failed: ${e instanceof Error ? e.message : e}`); setBusy(false) })
  }

  return createPortal(
    <div className="pedit__scrim" onClick={onClose}>
      <div className="pedit" role="dialog" aria-label="Edit primary ship and fandom" onClick={(e) => e.stopPropagation()}>
        <header className="pedit__head">
          <span className="pedit__title">Primary ship &amp; fandom</span>
          <button className="pedit__close" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="pedit__worktitle">{work.title}</div>

        <div className="pedit__group">
          <div className="pedit__label">Primary ship</div>
          <label className="pedit__opt">
            <input type="radio" name="ship" checked={ship === null} onChange={() => setShip(null)} /> Gen / none
          </label>
          {info.ships.map((c) => (
            <label key={c.tagId} className="pedit__opt">
              <input type="radio" name="ship" checked={ship === c.tagId} onChange={() => setShip(c.tagId)} /> {c.name}
            </label>
          ))}
          {info.ships.length === 0 && <div className="pedit__none">No relationship tags on this work.</div>}
        </div>

        <div className="pedit__group">
          <div className="pedit__label">Primary collection (fandom)</div>
          <label className="pedit__opt">
            <input type="radio" name="coll" checked={coll === null} onChange={() => setColl(null)} /> None
          </label>
          {info.fandoms.map((c) => (
            <label key={c.tagId} className="pedit__opt">
              <input type="radio" name="coll" checked={coll === c.tagId} onChange={() => setColl(c.tagId)} /> {c.name}
            </label>
          ))}
          {info.fandoms.length === 0 && <div className="pedit__none">No fandom tags on this work.</div>}
        </div>

        <footer className="pedit__foot">
          <Button variant="ghost" size="md" onClick={onClose}>Cancel</Button>
          <Button variant="primary" size="md" onClick={save} disabled={busy}>{busy ? 'Saving…' : 'Save'}</Button>
        </footer>
      </div>
    </div>,
    document.body,
  )
}
