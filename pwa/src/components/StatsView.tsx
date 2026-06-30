import { useMemo, useState } from 'react'
import './StatsView.css'
import { useLibrary } from '../data/library'
import { usePersistentState } from '../data/persist'
import { fmtWords } from '../mock/data'
import type { Work } from '../data/types'

/* Stats section. Lands on an index of reports (so it never opens straight into a
   single chart) — only "Reading activity" exists today; more can slot in beside it.
   Everything is computed client-side from the snapshot already in IndexedDB. */

const REPORTS = [
  { key: 'reading-activity', icon: '📈', label: 'Reading activity',
    desc: 'Completed works per day — Read / Favorite / DNF, with non-DNF wordcount.' },
  { key: 'ships-by-fandom', icon: '📊', label: 'Ships by fandom',
    desc: 'Unread / Read / Favorite / DNF per primary ship, grouped by primary collection.' },
] as const

export function StatsView() {
  const [report, setReport] = useState<string | null>(null)
  if (report === 'reading-activity') return <ReadingActivity onBack={() => setReport(null)} />
  if (report === 'ships-by-fandom') return <ShipsByFandom onBack={() => setReport(null)} />
  return (
    <div className="stats">
      <header className="stats__bar"><h1 className="stats__title">Stats</h1></header>
      <div className="stats__index">
        {REPORTS.map((r) => (
          <button key={r.key} className="stats__report" onClick={() => setReport(r.key)}>
            <span className="stats__reporticon" aria-hidden>{r.icon}</span>
            <span className="stats__reportlabel">{r.label}</span>
            <span className="stats__reportdesc">{r.desc}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/* ---- Reading activity report ------------------------------------------------ */

type Seg = 'read' | 'fav' | 'dnf'
const SEG_LABEL: Record<Seg, string> = { read: 'Read', fav: 'Favorite', dnf: 'DNF' }
const SEGS: Seg[] = ['read', 'fav', 'dnf']

const RANGES = [
  { key: '7', label: '7d', days: 7 },
  { key: '30', label: '30d', days: 30 },
  { key: '90', label: '90d', days: 90 },
  { key: 'all', label: 'All', days: 0 },
] as const
type RangeKey = (typeof RANGES)[number]['key']

const DAY = 86_400_000
const startOfDay = (ts: number) => { const d = new Date(ts); d.setHours(0, 0, 0, 0); return d.getTime() }
const startOfWeek = (ts: number) => { const d = new Date(startOfDay(ts)); return d.getTime() - ((d.getDay() + 6) % 7) * DAY }

/* The bar segment a completed work belongs to. Favorite wins over plain Read
   (different significance); DNF is its own segment and never counts toward words.
   Unread (no completion) → null, excluded. */
function segOf(w: Work): Seg | null {
  if (w.readStatus === 'DNF') return 'dnf'
  if (w.readStatus === 'Read') return w.isFavorite ? 'fav' : 'read'
  return null
}
// "Primary fandom" is the curated primary collection role (per-work review queue),
// not a raw fandom tag — the user equates the two.
const primaryFandom = (w: Work) => w.primaryCollection ?? '—'

type Item = { work: Work; seg: Seg; key: number }
type Bucket = { ts: number; read: number; fav: number; dnf: number; words: number }

function buildModel(works: Work[], rangeDays: number, now: number) {
  const completed: { w: Work; seg: Seg }[] = []
  for (const w of works) { const s = segOf(w); if (w.dateReadTs && s) completed.push({ w, seg: s }) }
  if (!completed.length) return { items: [] as Item[], buckets: [] as Bucket[], grain: 'day' as const }

  const earliest = completed.reduce((m, c) => Math.min(m, c.w.dateReadTs!), Infinity)
  const start = rangeDays > 0 ? startOfDay(now) - (rangeDays - 1) * DAY : startOfDay(earliest)
  const spanDays = Math.round((startOfDay(now) - start) / DAY) + 1
  const grain: 'day' | 'week' = spanDays > 120 ? 'week' : 'day'  // keep bar count readable
  const step = grain === 'week' ? DAY * 7 : DAY
  const bucketStart = grain === 'week' ? startOfWeek : startOfDay

  const map = new Map<number, Bucket>()
  for (let t = bucketStart(start); t <= bucketStart(startOfDay(now)); t += step)
    map.set(t, { ts: t, read: 0, fav: 0, dnf: 0, words: 0 })

  const items: Item[] = []
  for (const { w, seg } of completed) {
    if (w.dateReadTs! < start) continue
    const key = bucketStart(w.dateReadTs!)
    let b = map.get(key)
    if (!b) { b = { ts: key, read: 0, fav: 0, dnf: 0, words: 0 }; map.set(key, b) }
    b[seg]++
    if (seg !== 'dnf') b.words += w.wordcount ?? 0
    items.push({ work: w, seg, key })
  }
  return { items, buckets: [...map.values()].sort((a, b) => a.ts - b.ts), grain }
}

// SVG logical canvas (scales to container width via viewBox).
const W = 960, H = 300, PADL = 40, PADR = 44, PADT = 14, PADB = 30
const PLOT_H = H - PADT - PADB, PLOT_W = W - PADL - PADR
const niceMax = (v: number) => {
  if (v <= 5) return Math.max(1, v)
  const mag = Math.pow(10, Math.floor(Math.log10(v)))
  return Math.ceil(v / mag) * mag
}

type Selection = { status: Seg | null; ts: number | null }
const CLEARED: Selection = { status: null, ts: null }

function ReadingActivity({ onBack }: { onBack: () => void }) {
  const { works } = useLibrary()
  const [range, setRange] = usePersistentState<RangeKey>('sh.stats.range', '30')
  const [sel, setSel] = useState<Selection>(CLEARED)
  const [sort, setSort] = useState<{ key: string; dir: 'asc' | 'desc' }>({ key: 'date', dir: 'desc' })
  const days = RANGES.find((r) => r.key === range)!.days

  const { items, buckets, grain, totals } = useMemo(() => {
    const now = Date.now()
    const m = buildModel(works, days, now)
    const totals = m.buckets.reduce(
      (t, b) => ({ read: t.read + b.read, fav: t.fav + b.fav, dnf: t.dnf + b.dnf, words: t.words + b.words }),
      { read: 0, fav: 0, dnf: 0, words: 0 })
    return { ...m, totals }
  }, [works, days])

  const isFiltered = sel.status !== null || sel.ts !== null
  const matches = (seg: Seg, ts: number) =>
    (sel.status === null || sel.status === seg) && (sel.ts === null || sel.ts === ts)

  const clickSeg = (seg: Seg, ts: number) =>
    setSel((s) => (s.status === seg && s.ts === ts ? CLEARED : { status: seg, ts }))
  const clickLegend = (seg: Seg) =>
    setSel((s) => (s.status === seg && s.ts === null ? CLEARED : { status: seg, ts: null }))

  const fmtLabel = (ts: number) => new Date(ts).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })

  // Grid rows: completed items in range narrowed by the active selection, sorted.
  const rows = useMemo(() => {
    const sub = items.filter((it) => matches(it.seg, it.key)).map((it) => it.work)
    const dir = sort.dir === 'asc' ? 1 : -1
    const cmp = (a: Work, b: Work) => {
      switch (sort.key) {
        case 'title': return a.title.localeCompare(b.title) * dir
        case 'author': return (a.authors[0] ?? '').localeCompare(b.authors[0] ?? '') * dir
        case 'fandom': return primaryFandom(a).localeCompare(primaryFandom(b)) * dir
        case 'ship': return (a.primaryShip ?? '~').localeCompare(b.primaryShip ?? '~') * dir
        case 'words': return ((a.wordcount ?? 0) - (b.wordcount ?? 0)) * dir
        default: return ((a.dateReadTs ?? 0) - (b.dateReadTs ?? 0)) * dir
      }
    }
    return [...sub].sort(cmp)
  }, [items, sel, sort])

  const sortBy = (key: string) =>
    setSort((s) => (s.key === key
      ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
      : { key, dir: key === 'words' || key === 'date' ? 'desc' : 'asc' }))
  const arrow = (key: string) => (sort.key === key ? (sort.dir === 'asc' ? ' ▲' : ' ▼') : '')

  // Chart geometry
  const maxCount = niceMax(Math.max(1, ...buckets.map((b) => b.read + b.fav + b.dnf)))
  const maxWords = niceMax(Math.max(1, ...buckets.map((b) => b.words)))
  const n = buckets.length
  const slot = n ? PLOT_W / n : PLOT_W
  const barW = Math.max(1, Math.min(slot * 0.7, 34))
  const yW = (v: number) => PADT + PLOT_H * (1 - v / maxWords)
  const cx = (i: number) => PADL + slot * i + slot / 2
  const labelEvery = Math.max(1, Math.ceil(n / 8))
  const linePts = buckets.map((b, i) => ({ i, b })).filter((p) => p.b.read + p.b.fav > 0)

  const selLabel = sel.status
    ? `${SEG_LABEL[sel.status]}${sel.ts !== null ? ' · ' + fmtLabel(sel.ts) + (grain === 'week' ? ' wk' : '') : ''}`
    : null

  return (
    <div className="stats">
      <header className="stats__bar">
        <div className="stats__crumb">
          <button className="stats__back" onClick={onBack}>‹ Stats</button>
          <h1 className="stats__title">Reading activity</h1>
        </div>
        <div className="stats__range" role="group" aria-label="Range">
          {RANGES.map((r) => (
            <button key={r.key} className={'stats__rangebtn' + (r.key === range ? ' is-active' : '')}
              onClick={() => { setRange(r.key); setSel(CLEARED) }}>{r.label}</button>
          ))}
        </div>
      </header>

      <div className="stats__cards">
        <Card label="Read" value={String(totals.read)} kind="read" />
        <Card label="Favorites" value={String(totals.fav)} kind="fav" />
        <Card label="DNF" value={String(totals.dnf)} kind="dnf" />
        <Card label="Words read" value={fmtWords(totals.words)} kind="words" sub="non-DNF" />
      </div>

      {n === 0 ? (
        <div className="stats__empty">Nothing completed in this range.</div>
      ) : (
        <>
          <div className="stats__chartwrap">
            <svg className="stats__chart" viewBox={`0 0 ${W} ${H}`} role="img"
                 aria-label="Completed works per day with non-DNF wordcount">
              {[0, 0.5, 1].map((f) => {
                const v = Math.round(maxCount * f), y = PADT + PLOT_H * (1 - v / maxCount)
                return (
                  <g key={'c' + f}>
                    <line className="stats__grid" x1={PADL} x2={W - PADR} y1={y} y2={y} />
                    <text className="stats__axis" x={PADL - 6} y={y + 4} textAnchor="end">{v}</text>
                  </g>
                )
              })}
              {[0, 0.5, 1].map((f) => {
                const v = Math.round(maxWords * f), y = yW(v)
                return <text key={'w' + f} className="stats__axis stats__axis--words"
                             x={W - PADR + 6} y={y + 4} textAnchor="start">{fmtWords(v)}</text>
              })}
              {buckets.map((b, i) => {
                const x = cx(i) - barW / 2, base = PADT + PLOT_H
                const segH = (v: number) => (v / maxCount) * PLOT_H
                const hRead = segH(b.read), hFav = segH(b.fav), hDnf = segH(b.dnf)
                const yRead = base - hRead, yFav = yRead - hFav, yDnf = yFav - hDnf
                const dim = (seg: Seg) => isFiltered && !matches(seg, b.ts)
                const tip = `${fmtLabel(b.ts)}${grain === 'week' ? ' (wk)' : ''} — Read ${b.read}, ★ ${b.fav}, DNF ${b.dnf}, ${fmtWords(b.words)} words`
                const rect = (seg: Seg, y: number, h: number) => h > 0 && (
                  <rect className={`stats__seg stats__seg--${seg}` + (dim(seg) ? ' is-dim' : '')}
                        x={x} y={y} width={barW} height={h} onClick={() => clickSeg(seg, b.ts)}>
                    <title>{tip}</title>
                  </rect>
                )
                return <g key={b.ts}>{rect('read', yRead, hRead)}{rect('fav', yFav, hFav)}{rect('dnf', yDnf, hDnf)}</g>
              })}
              {linePts.length > 1 && (
                <polyline className={'stats__line' + (isFiltered ? ' is-dim' : '')}
                  points={linePts.map((p) => `${cx(p.i)},${yW(p.b.words)}`).join(' ')} />
              )}
              {buckets.map((b, i) => (i % labelEvery === 0 ? (
                <text key={'x' + b.ts} className="stats__axis" x={cx(i)} y={H - 10} textAnchor="middle">{fmtLabel(b.ts)}</text>
              ) : null))}
            </svg>
          </div>

          <div className="stats__gridhead">
            <span className="stats__count">{rows.length} {rows.length === 1 ? 'story' : 'stories'}</span>
            {isFiltered && (
              <button className="stats__selchip" onClick={() => setSel(CLEARED)}>{selLabel} ✕</button>
            )}
          </div>

          <div className="stats__tablewrap">
            <table className="stats__table">
              <thead>
                <tr>
                  <th onClick={() => sortBy('title')}>Title{arrow('title')}</th>
                  <th onClick={() => sortBy('author')}>Author{arrow('author')}</th>
                  <th onClick={() => sortBy('fandom')}>Fandom{arrow('fandom')}</th>
                  <th onClick={() => sortBy('ship')}>Ship{arrow('ship')}</th>
                  <th className="stats__num" onClick={() => sortBy('words')}>Words{arrow('words')}</th>
                  <th onClick={() => sortBy('date')}>Date read{arrow('date')}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((w) => (
                  <tr key={w.workId}>
                    <td className="stats__ttl" title={w.title}>{w.title}</td>
                    <td title={w.authors.join(', ')}>{w.authors[0] ?? '—'}</td>
                    <td title={primaryFandom(w)}>{primaryFandom(w)}</td>
                    <td title={w.primaryShip ?? 'Gen'}>{w.primaryShip ?? 'Gen'}</td>
                    <td className="stats__num">{fmtWords(w.wordcount)}</td>
                    <td>{w.dateRead ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="stats__legend">
            {SEGS.map((seg) => {
              const active = sel.status === seg && sel.ts === null
              return (
                <button key={seg} className={'stats__lg' + (active ? ' is-active' : '')} onClick={() => clickLegend(seg)}>
                  <i className={`stats__sw stats__sw--${seg}`} />{SEG_LABEL[seg]}
                  <span className="stats__lgn">{totals[seg]}</span>
                </button>
              )
            })}
            <span className="stats__lg stats__lg--static"><i className="stats__sw stats__sw--line" />Words (non-DNF)</span>
          </div>
        </>
      )}
    </div>
  )
}

function Card({ label, value, kind, sub }: { label: string; value: string; kind: string; sub?: string }) {
  return (
    <div className={'stats__card stats__card--' + kind}>
      <div className="stats__cardval">{value}</div>
      <div className="stats__cardlbl">{label}{sub ? <span className="stats__cardsub"> · {sub}</span> : null}</div>
    </div>
  )
}

/* ---- Ships by fandom report ------------------------------------------------- */

type Status4 = 'unread' | 'read' | 'fav' | 'dnf'
const SBF_ORDER: Status4[] = ['read', 'fav', 'dnf', 'unread']  // stack order, left→right
const STATUS4_LABEL: Record<Status4, string> = { unread: 'Unread', read: 'Read', fav: 'Favorite', dnf: 'DNF' }

function status4Of(w: Work): Status4 {
  if (w.readStatus === 'DNF') return 'dnf'
  if (w.isFavorite) return 'fav'       // favorite carved out of Read (its own segment)
  if (w.readStatus === 'Read') return 'read'
  return 'unread'
}
// A poly ship has 2+ "/" (3+ partners). Optionally collapse all such ships into "Poly".
const isPoly = (ship: string) => (ship.match(/\//g) || []).length > 1
const shipLabel = (ship: string, groupPoly: boolean) => (groupPoly && isPoly(ship) ? 'Poly' : ship)

type Counts = Record<Status4, number>
type ShipRow = { ship: string; counts: Counts; total: number }
type FandomGroup = { fandom: string; rows: ShipRow[]; total: number }
const NO_COLL = '(No collection)'

function buildShipsByFandom(works: Work[], fandomFilter: string, groupPoly: boolean): FandomGroup[] {
  const fmap = new Map<string, Map<string, Counts>>()
  for (const w of works) {
    const fandom = w.primaryCollection ?? NO_COLL
    if (fandomFilter && fandom !== fandomFilter) continue
    const ship = shipLabel(w.primaryShip ?? 'Gen', groupPoly)
    let smap = fmap.get(fandom)
    if (!smap) { smap = new Map(); fmap.set(fandom, smap) }
    let c = smap.get(ship)
    if (!c) { c = { unread: 0, read: 0, fav: 0, dnf: 0 }; smap.set(ship, c) }
    c[status4Of(w)]++
  }
  const groups: FandomGroup[] = []
  for (const [fandom, smap] of fmap) {
    const rows: ShipRow[] = [...smap].map(([ship, counts]) => ({
      ship, counts, total: counts.unread + counts.read + counts.fav + counts.dnf,
    }))
    rows.sort((a, b) => b.total - a.total || a.ship.localeCompare(b.ship))
    groups.push({ fandom, rows, total: rows.reduce((s, r) => s + r.total, 0) })
  }
  groups.sort((a, b) => b.total - a.total || a.fandom.localeCompare(b.fandom))
  return groups
}

function ShipsByFandom({ onBack }: { onBack: () => void }) {
  const { works } = useLibrary()
  const [fandom, setFandom] = usePersistentState('sh.stats.sbf.fandom', '')
  const [groupPoly, setGroupPoly] = usePersistentState('sh.stats.sbf.poly', false)

  // Fandom dropdown options from the FULL library (stable regardless of filter),
  // by descending work count.
  const fandomOpts = useMemo(() => {
    const m = new Map<string, number>()
    for (const w of works) { const f = w.primaryCollection ?? NO_COLL; m.set(f, (m.get(f) ?? 0) + 1) }
    return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([f]) => f)
  }, [works])

  const groups = useMemo(() => buildShipsByFandom(works, fandom, groupPoly), [works, fandom, groupPoly])
  const totals = useMemo(() => {
    const t: Counts = { unread: 0, read: 0, fav: 0, dnf: 0 }
    for (const g of groups) for (const r of g.rows) for (const s of SBF_ORDER) t[s] += r.counts[s]
    return t
  }, [groups])

  const maxRow = Math.max(1, ...groups.flatMap((g) => g.rows.map((r) => r.total)))

  return (
    <div className="stats">
      <header className="stats__bar">
        <div className="stats__crumb">
          <button className="stats__back" onClick={onBack}>‹ Stats</button>
          <h1 className="stats__title">Ships by fandom</h1>
        </div>
        <div className="stats__controls">
          <label className="stats__check">
            <input type="checkbox" checked={groupPoly} onChange={(e) => setGroupPoly(e.target.checked)} />
            Group poly
          </label>
          <select className="stats__select" value={fandom} onChange={(e) => setFandom(e.target.value)}
                  aria-label="Filter by fandom">
            <option value="">All fandoms</option>
            {fandomOpts.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
      </header>

      <div className="stats__cards">
        <Card label="Unread" value={String(totals.unread)} kind="unread" />
        <Card label="Read" value={String(totals.read)} kind="read" />
        <Card label="Favorites" value={String(totals.fav)} kind="fav" />
        <Card label="DNF" value={String(totals.dnf)} kind="dnf" />
      </div>

      {groups.length === 0 ? (
        <div className="stats__empty">No works match.</div>
      ) : (
        <div className="sbf">
          {groups.map((g) => (
            <section key={g.fandom} className="sbf__group">
              <div className="sbf__fandom">{g.fandom}<span className="sbf__fcount">{g.total}</span></div>
              {g.rows.map((r) => {
                const tip = `${r.ship} — Read ${r.counts.read}, ★ ${r.counts.fav}, DNF ${r.counts.dnf}, Unread ${r.counts.unread} (${r.total})`
                return (
                  <div key={r.ship} className="sbf__row" title={tip}>
                    <div className="sbf__ship" title={r.ship}>{r.ship}</div>
                    <div className="sbf__barcell">
                      <div className="sbf__bar" style={{ width: (r.total / maxRow) * 100 + '%' }}>
                        {SBF_ORDER.map((s) => (r.counts[s] > 0 ? (
                          <div key={s} className={`sbf__seg sbf__seg--${s}`} style={{ flexGrow: r.counts[s] }} />
                        ) : null))}
                      </div>
                    </div>
                    <div className="sbf__total">{r.total}</div>
                  </div>
                )
              })}
            </section>
          ))}
        </div>
      )}

      <div className="stats__legend">
        {SBF_ORDER.map((s) => (
          <span key={s} className="stats__lg stats__lg--static">
            <i className={`stats__sw stats__sw--${s}`} />{STATUS4_LABEL[s]}
          </span>
        ))}
      </div>
    </div>
  )
}
