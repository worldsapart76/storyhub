import { useMemo, useRef, useState } from 'react'
import './StoryCard.css'
import { type Work, type Tag, type Category, type ReadStatus, fmtWords } from '../mock/data'
import { StatusBadge, RatingBadge, FavoriteStar, AvailabilityNote } from './Badge'
import { StatusCluster } from './StatusCluster'
import { Button } from './Button'
import { openEpub, openAo3 } from '../data/epub'
import { addListMembers, createReadingList, fetchReadingLists, type ReadingListRow } from '../data/lists'

/* Cross-cutting result card (browse.md "Result card content" + B+ series model).
   Used in Browse, Reading List detail, Saved Filter results, search.

   Collapsed: 2-line summary + first N tags (flat). Expanding (via "Show more",
   "+N more", or the details chevron) reveals the FULL summary and ALL tags
   GROUPED by category, with ◇ marking canonical group chips (§6.3.1).

   `nested` = rendered inside a series expander: suppresses its own series block
   (no recursion) and the select checkbox, and reads as a sub-card. */

const MAX_INLINE_TAGS = 6

// Category render order for the expanded grouped view (browse.md §7.3.1).
const CATEGORY_ORDER: Category[] = [
  'Fandom', 'Relationship', 'Character', 'Identity', 'Universe', 'Content',
  'Trope', 'Dynamics', 'Mood', 'Structure', 'Other', 'Rating',
]

export function StoryCard({
  work,
  selectable,
  selected,
  nested,
  onSelect,
  onRead,
  onFavorite,
  onPin,
  onStatus,
  canAddToList,
}: {
  work: Work
  selectable?: boolean
  selected?: boolean
  nested?: boolean
  onSelect?: () => void
  /** Launch the in-app reader (§5 fallback). When omitted, the action is hidden —
      "Open EPUB" alone hands the file to the OS reader. */
  onRead?: () => void
  /** Persisting handlers (wired in Browse). When passed, the control is CONTROLLED
      by the `work` prop (the provider's optimistic state); when omitted, the card
      falls back to local-only toggles (the design gallery). */
  onFavorite?: (next: boolean) => void
  onPin?: (next: boolean) => void
  onStatus?: (next: ReadStatus) => void
  /** Enable the "+ List" add-to-list menu (real app only; the gallery omits it). */
  canAddToList?: boolean
}) {
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [tagsOpen, setTagsOpen] = useState(false)
  const [seriesOpen, setSeriesOpen] = useState(false)
  const [openSibling, setOpenSibling] = useState<number | null>(null)
  const [localFav, setLocalFav] = useState(work.isFavorite)
  const [localPinned, setLocalPinned] = useState(work.pinned)
  const [localStatus, setLocalStatus] = useState<ReadStatus>(work.readStatus)
  const [epubBusy, setEpubBusy] = useState(false)

  // Controlled by the work prop when a persisting handler is wired, else local.
  const fav = onFavorite ? work.isFavorite : localFav
  const pinned = onPin ? work.pinned : localPinned
  const status = onStatus ? work.readStatus : localStatus
  // Un-favoriting a story removes its private AO3 bookmark (final state), so guard
  // it. Favoriting (adding) and the local/gallery toggle need no confirm.
  const toggleFav = () => {
    if (!onFavorite) { setLocalFav((f) => !f); return }
    if (fav && !window.confirm(`Remove “${work.title}” from favorites? This also removes its AO3 bookmark.`)) return
    onFavorite(!fav)
  }
  const togglePin = () => (onPin ? onPin(!pinned) : setLocalPinned((p) => !p))
  const changeStatus = (s: ReadStatus) => (onStatus ? onStatus(s) : setLocalStatus(s))

  const onEpub = async () => {
    setEpubBusy(true)
    const err = await openEpub(work)
    setEpubBusy(false)
    if (err) alert(err)
  }

  const inline = work.tags.slice(0, MAX_INLINE_TAGS)
  const extra = work.tags.length - MAX_INLINE_TAGS
  const summaryParas = useMemo(() => work.summary.split('\n\n'), [work.summary])
  const longSummary = work.summary.length > 180 || summaryParas.length > 1

  // Group tags by category for the expanded view.
  const grouped = useMemo(() => {
    const map = new Map<Category, Tag[]>()
    for (const tag of work.tags) {
      const arr = map.get(tag.category) ?? []
      arr.push(tag)
      map.set(tag.category, arr)
    }
    return CATEGORY_ORDER.filter((c) => map.has(c)).map((c) => [c, map.get(c)!] as const)
  }, [work.tags])

  return (
    <article className={'card' + (selected ? ' is-selected' : '') + (nested ? ' card--nested' : '')}>
      {selectable && !nested && (
        <input className="card__check" type="checkbox" checked={selected} onChange={onSelect} aria-label={`Select ${work.title}`} />
      )}

      <div className="card__main">
        <div className="card__top">
          <div className="card__titlewrap">
            <h3 className="card__title">{work.title}</h3>
            <div className="card__byline">by {work.authors.join(', ')}</div>
          </div>
          <FavoriteStar on={fav} onClick={toggleFav} />
        </div>

        <div className="card__meta">
          <RatingBadge rating={work.rating} />
          <StatusBadge status={status} />
          {work.primaryShip ? (
            <span className="card__ship">♥ {work.primaryShip}</span>
          ) : (
            <span className="card__ship card__ship--gen">Gen</span>
          )}
          {work.primaryCollection && <span className="card__coll">{work.primaryCollection}</span>}
          <span className="card__words">{fmtWords(work.wordcount)} words</span>
          {work.chapterCount && (
            <span className="card__chapters">{work.chapterCount} ch{work.isComplete ? '' : ' · WIP'}</span>
          )}
          {work.dateAdded && <span className="card__date">Added {work.dateAdded}</span>}
          {work.dateRead && <span className="card__date">Read {work.dateRead}</span>}
          {work.availability === 'deleted' && <AvailabilityNote value="deleted" />}
          {work.availability === 'locked' && <AvailabilityNote value="locked" />}
        </div>

        {/* Summary — independent toggle. Clamped to 2 lines collapsed. */}
        {summaryOpen ? (
          <div className="card__summaryfull">
            {summaryParas.map((p, i) => (
              <p key={i} className="card__para">{p}</p>
            ))}
          </div>
        ) : (
          <p className="card__summary">{work.summary}</p>
        )}
        {longSummary && (
          <button className="card__more" onClick={() => setSummaryOpen((o) => !o)}>
            {summaryOpen ? '▴ Show less' : '▾ Show full summary'}
          </button>
        )}

        {/* Tags — independent toggle. Flat row collapsed; grouped-by-category expanded. */}
        {tagsOpen ? (
          <div className="card__taggroups">
            {grouped.map(([cat, tags]) => (
              <div key={cat} className="card__taggroup">
                <span className="card__catlabel">{cat}</span>
                <div className="card__taggroupchips">
                  {tags.map((tag) => (
                    <TagChip key={tag.name} tag={tag} />
                  ))}
                </div>
              </div>
            ))}
            <button className="card__more" onClick={() => setTagsOpen(false)}>▴ Show fewer tags</button>
          </div>
        ) : (
          <div className="card__tags">
            {inline.map((tag) => (
              <TagChip key={tag.name} tag={tag} />
            ))}
            {extra > 0 && (
              <button className="card__moretags" onClick={() => setTagsOpen(true)}>+{extra} more</button>
            )}
          </div>
        )}

        {/* Action row — work-level quick actions (full set lives in reading flow). */}
        {!nested && (
          <div className="card__actions">
            <Button variant="primary" size="sm" title="Open in your device's default reader"
                    onClick={onEpub} disabled={epubBusy}>{epubBusy ? '…' : 'EPUB'}</Button>
            {work.availability === 'live' && (
              <Button variant="outline" size="sm" onClick={() => openAo3(work)}>AO3</Button>
            )}
            {onRead && (
              <Button variant="secondary" size="sm" onClick={onRead} title="Read in the built-in reader">Read here</Button>
            )}
            <StatusCluster status={status} compact hideFavorite onStatus={changeStatus} />
            <AddToList work={work} enabled={canAddToList} />
          </div>
        )}

        {!nested && work.series && (
          <div className="card__series">
            <button className="card__seriesbtn" onClick={() => setSeriesOpen((o) => !o)}>
              <span className={'card__caret' + (seriesOpen ? ' is-open' : '')}>▸</span>
              📚 {work.series.name} #{work.series.index}
              <span className="card__seriesmatch">{work.series.matchIds.length} of {work.series.total} match</span>
            </button>
            {seriesOpen && (
              <ol className="card__siblings">
                {work.series.siblings.map((s, idx) => {
                  const isOpen = openSibling === s.workId
                  const matches = work.series!.matchIds.includes(s.workId)
                  const isSelf = s.workId === work.workId
                  return (
                    <li key={s.workId} className="card__siblingitem">
                      <button
                        className={'card__sibling' + (matches ? '' : ' is-dim') + (isSelf ? ' is-self' : '')}
                        onClick={() => setOpenSibling(isOpen ? null : s.workId)}
                        aria-expanded={isOpen}
                      >
                        <span className={'card__caret card__caret--sm' + (isOpen ? ' is-open' : '')}>▸</span>
                        <span className="card__sibtitle">
                          #{idx + 1} · {s.title}
                          {isSelf && <span className="card__sibself"> (this one)</span>}
                        </span>
                        <StatusBadge status={s.readStatus} />
                        <span className="card__sibwords">{fmtWords(s.wordcount)}</span>
                      </button>
                      {isOpen && (
                        <div className="card__sibcard">
                          <StoryCard work={s} nested />
                        </div>
                      )}
                    </li>
                  )
                })}
              </ol>
            )}
          </div>
        )}
      </div>

      {!nested && (
        <button
          className={'card__pin' + (pinned ? ' is-on' : '')}
          title={pinned ? 'Pinned offline' : 'Pin for offline'}
          aria-pressed={pinned}
          onClick={togglePin}
        >
          {pinned ? '📌' : '📍'}
        </button>
      )}
    </article>
  )
}

/* "+ List" add-to-list menu. Lazily loads the user's lists on first open; lets you
   pick one or create-and-add. Inert (no menu) when `enabled` is false (gallery). */
function AddToList({ work, enabled }: { work: Work; enabled?: boolean }) {
  const [open, setOpen] = useState(false)
  const [lists, setLists] = useState<ReadingListRow[] | null>(null)
  const [creating, setCreating] = useState(false)
  const [added, setAdded] = useState<string | null>(null)
  const done = useRef(false)

  const openMenu = () => {
    if (!enabled) return
    setOpen(true)
    if (!lists) fetchReadingLists().then((ls) => setLists(ls.filter((l) => !l.isSystem))).catch(() => setLists([]))
  }
  const close = () => { setOpen(false); setCreating(false) }
  const flash = (name: string) => { setAdded(name); setTimeout(() => setAdded(null), 1500) }
  const add = (listId: string, name: string) => {
    close()
    addListMembers(listId, [work.workId]).then(() => flash(name)).catch((e) => alert(`Couldn’t add: ${e instanceof Error ? e.message : e}`))
  }
  const createAndAdd = (raw: string) => {
    if (done.current) return
    done.current = true
    const n = raw.trim()
    close()
    if (!n) return
    createReadingList({ name: n, starred: false })
      .then((row) => addListMembers(row.id, [work.workId]))
      .then(() => flash(n))
      .catch((e) => alert(`Couldn’t create list: ${e instanceof Error ? e.message : e}`))
  }

  return (
    <div className="card__listwrap">
      <Button variant="secondary" size="sm" onClick={openMenu}>{added ? `✓ ${added}` : '+ List'}</Button>
      {open && (
        <>
          <div className="card__listscrim" onClick={close} />
          <ul className="card__listmenu" role="menu">
            {lists === null && <li className="card__listempty">Loading…</li>}
            {lists?.map((l) => (
              <li key={l.id}><button className="card__listitem" onClick={() => add(l.id, l.name)}>{l.name}</button></li>
            ))}
            {lists && lists.length === 0 && <li className="card__listempty">No lists yet</li>}
            <li>
              {creating ? (
                <input className="card__listnew" autoFocus placeholder="New list…"
                  onFocus={() => { done.current = false }}
                  onKeyDown={(e) => { if (e.key === 'Enter') createAndAdd(e.currentTarget.value); if (e.key === 'Escape') close() }}
                  onBlur={(e) => createAndAdd(e.target.value)} />
              ) : (
                <button className="card__listitem card__listitem--new" onClick={() => { done.current = false; setCreating(true) }}>+ New list…</button>
              )}
            </li>
          </ul>
        </>
      )}
    </div>
  )
}

function TagChip({ tag }: { tag: Tag }) {
  return (
    <span
      className={'card__tag' + (tag.grouped ? ' card__tag--grouped' : '')}
      data-cat={tag.category}
      title={tag.grouped ? `${tag.name} — group of ${tag.synonyms ?? 'several'} tags` : `${tag.category}: ${tag.name}`}
    >
      {tag.grouped && <span className="card__tagmark" aria-hidden>◇</span>}
      {tag.name}
      {tag.grouped && tag.synonyms ? <span className="card__tagsyn">+{tag.synonyms}</span> : null}
    </span>
  )
}
