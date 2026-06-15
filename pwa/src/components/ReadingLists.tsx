import { useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react'
import './ReadingLists.css'
import { READING_LISTS_DATA, WORKS, fmtWords, sortReadingLists, type ReadingList, type Work } from '../mock/data'
import { StoryCard } from './StoryCard'
import { Reader } from './Reader'
import { Button } from './Button'

/* Reading Lists (redesign §6.4 / docs/ux/reading-lists.md). Index → detail.
   - Covers are stylized color blocks (square, the documented empty-list fallback;
     real app uploads are cropped 200×200).
   - FAVORITES is the one system smart list: rule-derived membership (is_favorite),
     non-deletable, NO manual add/remove and NO reorder. PRIORITY is an ordinary
     list that merely ships auto-starred.
   - Detail reorder is native drag-and-drop, active only when sorted by Manual
     (position); any standard sort disables the grip. */

const worksById = new Map<number, Work>(WORKS.map((w) => [w.workId, { ...w, series: undefined }]))

type ListSort = 'manual' | 'added' | 'words' | 'title'
const SORT_LABELS: Record<ListSort, string> = {
  manual: 'Manual (position)', added: 'Added ↓', words: 'Words ↓', title: 'Title',
}

export function ReadingLists() {
  const [lists, setLists] = useState<ReadingList[]>(READING_LISTS_DATA)
  const [openId, setOpenId] = useState<number | null>(null)

  const open = openId == null ? null : lists.find((l) => l.id === openId) ?? null
  const updateList = (id: number, fn: (l: ReadingList) => ReadingList) =>
    setLists((prev) => prev.map((l) => (l.id === id ? fn(l) : l)))

  const toggleStar = (id: number) => updateList(id, (l) => ({ ...l, starred: !l.starred }))

  if (open) {
    return (
      <ListDetail
        list={open}
        otherLists={lists.filter((l) => l.id !== open.id)}
        onBack={() => setOpenId(null)}
        onUpdate={(fn) => updateList(open.id, fn)}
      />
    )
  }
  return <ListIndex lists={lists} onOpen={setOpenId} onToggleStar={toggleStar} />
}

function StarBtn({ on, onClick, locked, className }: { on: boolean; onClick: () => void; locked?: boolean; className?: string }) {
  return (
    <button
      className={'rl__star' + (on ? ' is-on' : '') + (locked ? ' is-locked' : '') + (className ? ' ' + className : '')}
      onClick={(e) => { e.stopPropagation(); if (!locked) onClick() }}
      role="switch"
      aria-checked={on}
      disabled={locked}
      aria-label={locked ? 'Favorites is always starred' : on ? 'Unstar list' : 'Star list (show as a Browse chip)'}
      title={locked ? 'Always starred' : on ? 'Starred — shown as a Browse chip' : 'Star — show as a Browse chip'}
    >
      {on ? '★' : '☆'}
    </button>
  )
}

/* ------------------------------- Index ---------------------------------- */
function ListIndex({ lists, onOpen, onToggleStar }: { lists: ReadingList[]; onOpen: (id: number) => void; onToggleStar: (id: number) => void }) {
  return (
    <div className="rl">
      <header className="rl__head">
        <h1 className="rl__title">Reading Lists</h1>
        <Button variant="primary" size="sm">+ New list</Button>
      </header>

      <div className="rl__grid">
        {sortReadingLists(lists).map((l) => (
          <div key={l.id} className="rl__card" role="button" tabIndex={0}
            onClick={() => onOpen(l.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l.id) } }}>
            <Cover list={l}>
              <StarBtn on={!!l.starred} locked={l.isSystem} onClick={() => onToggleStar(l.id)} className="rl__star--cover" />
            </Cover>
            <div className="rl__cardbody">
              <div className="rl__cardtop">
                <span className="rl__cardname">{l.name}</span>
                <span className="rl__cardcount">{l.memberIds.length}</span>
              </div>
              {l.description && <span className="rl__carddesc">{l.description}</span>}
              {l.autoPin && <span className="rl__badges"><span className="rl__badge rl__badge--pin" title="Auto-pin: every member downloaded for offline">📌 offline</span></span>}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* Cover block. In detail mode `onPick` makes it a clickable upload target; an
   uploaded image is center-cropped to a square (object-fit: cover), making the
   200×200 contract visible. `children` is the corner star overlay. */
function Cover({
  list, large, onPick, children,
}: {
  list: ReadingList
  large?: boolean
  onPick?: () => void
  children?: ReactNode
}) {
  const empty = list.memberIds.length === 0 && !list.coverUrl
  const cls = 'rl__cover' + (large ? ' rl__cover--lg' : '') + (empty ? ' is-empty' : '') + (onPick ? ' is-editable' : '')
  const inner = (
    <>
      {list.coverUrl && <img className="rl__coverimg" src={list.coverUrl} alt="" />}
      <span className="rl__covername">{list.name}</span>
      {empty && <span className="rl__coverempty">empty</span>}
      {onPick && <span className="rl__coverpick" aria-hidden>📷</span>}
      {children}
    </>
  )
  if (onPick) {
    return (
      <button type="button" className={cls} style={{ ['--list-color' as string]: list.color }} onClick={onPick} aria-label="Upload cover image">
        {inner}
      </button>
    )
  }
  return <div className={cls} style={{ ['--list-color' as string]: list.color }} aria-hidden>{inner}</div>
}

/* ------------------------------- Detail --------------------------------- */
function ListDetail({
  list, otherLists, onBack, onUpdate,
}: {
  list: ReadingList
  otherLists: ReadingList[]
  onBack: () => void
  onUpdate: (fn: (l: ReadingList) => ReadingList) => void
}) {
  const system = !!list.isSystem
  // Manual (position) is only meaningful for hand-ordered lists; a rule-based
  // system list has no manual order, so it's hidden and never the default.
  const sortOptions: ListSort[] = system ? ['added', 'words', 'title'] : ['manual', 'added', 'words', 'title']
  const [sort, setSort] = useState<ListSort>(sortOptions[0])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState(false)
  const [editDesc, setEditDesc] = useState(false)
  const [readerWork, setReaderWork] = useState<Work | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const onCoverFile = (e: ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0]
    if (f) onUpdate((l) => ({ ...l, coverUrl: URL.createObjectURL(f) }))
    e.target.value = ''
  }
  const commitTitle = (v: string) => { const n = v.trim(); if (n) onUpdate((l) => ({ ...l, name: n })); setEditTitle(false) }
  const commitDesc = (v: string) => { onUpdate((l) => ({ ...l, description: v.trim() || undefined })); setEditDesc(false) }

  const canReorder = sort === 'manual'

  const members = useMemo(() => {
    const ws = list.memberIds.map((id) => worksById.get(id)).filter(Boolean) as Work[]
    if (sort === 'manual') return ws
    const arr = [...ws]
    if (sort === 'added') arr.reverse()
    if (sort === 'words') arr.sort((a, b) => b.wordcount - a.wordcount)
    if (sort === 'title') arr.sort((a, b) => a.title.localeCompare(b.title))
    return arr
  }, [list.memberIds, sort])

  const toggleSel = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const reorder = (from: number, to: number) => {
    if (from === to) return
    onUpdate((l) => {
      const ids = [...l.memberIds]
      const fi = ids.indexOf(from)
      if (fi < 0) return l
      ids.splice(fi, 1)                 // remove first…
      const ti = ids.indexOf(to)        // …then locate the target in the shrunk list
      if (ti < 0) return l
      ids.splice(ti, 0, from)           // insert before the target
      return { ...l, memberIds: ids }
    })
  }

  const removeSelected = () => {
    onUpdate((l) => ({ ...l, memberIds: l.memberIds.filter((id) => !selected.has(id)) }))
    setSelected(new Set())
  }

  return (
    <div className="rl rl--detail">
      <button className="rl__back" onClick={onBack}>‹ Reading Lists</button>

      <input ref={fileRef} type="file" accept="image/*" hidden onChange={onCoverFile} />

      <header className="rl__dethead">
        <Cover list={list} large onPick={() => fileRef.current?.click()} />
        <div className="rl__detmeta">
          <div className="rl__dettop">
            {editTitle && !system ? (
              <input className="rl__titleinput" defaultValue={list.name} autoFocus
                onBlur={(e) => commitTitle(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') commitTitle(e.currentTarget.value); if (e.key === 'Escape') setEditTitle(false) }} />
            ) : (
              <h1 className={'rl__title' + (system ? '' : ' rl__title--edit')} onClick={() => !system && setEditTitle(true)}
                title={system ? undefined : 'Click to rename'}>{list.name}</h1>
            )}
            <StarBtn on={!!list.starred} locked={system} onClick={() => onUpdate((l) => ({ ...l, starred: !l.starred }))} className="rl__star--head" />
            <button
              className={'rl__pin' + (list.autoPin ? ' is-on' : '')}
              onClick={() => onUpdate((l) => ({ ...l, autoPin: !l.autoPin }))}
              aria-pressed={list.autoPin}
              aria-label={list.autoPin ? 'Pinned offline — every member downloaded' : 'Pin list for offline'}
              title={list.autoPin ? 'Pinned offline' : 'Pin for offline'}
            >
              {list.autoPin ? '📌' : '📍'}
            </button>
            {system && <span className="rl__badge rl__badge--system">system</span>}
          </div>

          {editDesc && !system ? (
            <textarea className="rl__descinput" defaultValue={list.description ?? ''} autoFocus rows={2}
              onBlur={(e) => commitDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitDesc(e.currentTarget.value) } if (e.key === 'Escape') setEditDesc(false) }} />
          ) : list.description ? (
            <p className={'rl__detdesc' + (system ? '' : ' rl__detdesc--edit')} onClick={() => !system && setEditDesc(true)}
              title={system ? undefined : 'Click to edit'}>{list.description}</p>
          ) : (
            !system && <button className="rl__adddesc" onClick={() => setEditDesc(true)}>+ description</button>
          )}

          <div className="rl__detstats">
            <span>{members.length} works</span>
            <span>·</span>
            <span>{fmtWords(members.reduce((s, w) => s + w.wordcount, 0))} words total</span>
          </div>

          <div className="rl__detctrls">
            <label className="rl__sortwrap">
              Sort
              <select className="rl__sort" value={sort} onChange={(e) => setSort(e.target.value as ListSort)}>
                {sortOptions.map((s) => (
                  <option key={s} value={s}>{SORT_LABELS[s]}</option>
                ))}
              </select>
            </label>
            {!system && <Button variant="ghost" size="sm">Delete</Button>}
          </div>
        </div>
      </header>

      {selected.size > 0 && (
        <MemberBulkBar
          count={selected.size}
          otherLists={otherLists}
          system={system}
          onRemove={removeSelected}
          onClear={() => setSelected(new Set())}
        />
      )}

      {members.length === 0 ? (
        <div className="rl__empty">No works in this list yet. Add from Browse or a story card’s <strong>+ List</strong>.</div>
      ) : (
        <ol className="rl__members">
          {members.map((w) => (
            <li
              key={w.workId}
              className={'rl__memberrow' + (overId === w.workId && dragId !== w.workId ? ' is-over' : '') + (dragId === w.workId ? ' is-dragging' : '')}
              onDragEnter={() => canReorder && dragId != null && setOverId(w.workId)}
              onDragOver={(e) => { if (canReorder && dragId != null) e.preventDefault() }}
              onDrop={() => { if (canReorder && dragId != null) reorder(dragId, w.workId); setDragId(null); setOverId(null) }}
            >
              {canReorder && (
                <span
                  className="rl__grip"
                  title="Drag to reorder"
                  aria-label="Drag to reorder"
                  draggable
                  onDragStart={(e) => { setDragId(w.workId); e.dataTransfer.effectAllowed = 'move' }}
                  onDragEnd={() => { setDragId(null); setOverId(null) }}
                >⠿</span>
              )}
              <div className="rl__membercard">
                <StoryCard work={w} selectable selected={selected.has(w.workId)} onSelect={() => toggleSel(w.workId)} onRead={() => setReaderWork(w)} />
              </div>
            </li>
          ))}
        </ol>
      )}

      {readerWork && <Reader work={readerWork} onClose={() => setReaderWork(null)} />}
    </div>
  )
}

function MemberBulkBar({
  count, otherLists, system, onRemove, onClear,
}: {
  count: number
  otherLists: ReadingList[]
  system: boolean
  onRemove: () => void
  onClear: () => void
}) {
  const [menu, setMenu] = useState<null | 'move' | 'add'>(null)
  const close = () => setMenu(null)
  return (
    <div className="rl__bulk" role="toolbar" aria-label="List member actions">
      <span className="rl__bulkcount">{count} selected</span>
      <div className="rl__bulkactions">
        <button className="rl__bulkbtn" onClick={onRemove} disabled={system} title={system ? 'Un-favorite the work to remove it' : undefined}>
          Remove from list
        </button>
        <div className="rl__bulkwrap">
          <button className="rl__bulkbtn" onClick={() => setMenu((m) => (m === 'move' ? null : 'move'))} disabled={system} aria-expanded={menu === 'move'}>Move to ▾</button>
          {menu === 'move' && <ListMenu lists={otherLists} onPick={close} onClose={close} />}
        </div>
        <div className="rl__bulkwrap">
          <button className="rl__bulkbtn" onClick={() => setMenu((m) => (m === 'add' ? null : 'add'))} aria-expanded={menu === 'add'}>Add to ▾</button>
          {menu === 'add' && <ListMenu lists={otherLists} onPick={close} onClose={close} />}
        </div>
      </div>
      <button className="rl__bulkclear" onClick={onClear} aria-label="Clear selection">✕</button>
    </div>
  )
}

function ListMenu({ lists, onPick, onClose }: { lists: ReadingList[]; onPick: () => void; onClose: () => void }) {
  return (
    <>
      <div className="rl__scrim" onClick={onClose} />
      <ul className="rl__menu" role="listbox">
        {lists.map((l) => (
          <li key={l.id}>
            <button className="rl__menuitem" onClick={onPick}>
              <span className="rl__menudot" style={{ background: l.color }} aria-hidden />
              {l.name}
            </button>
          </li>
        ))}
      </ul>
    </>
  )
}
