import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import './ReadingLists.css'
import { fmtWords } from '../mock/data'
import { StoryCard } from './StoryCard'
import { Reader } from './Reader'
import { Button } from './Button'
import { useLibrary } from '../data/library'
import {
  createReadingList, deleteReadingList, fetchReadingLists,
  patchReadingList, removeListMembers, reorderListMembers, type ReadingListRow,
} from '../data/lists'
import type { Work } from '../data/types'

/* Reading Lists (redesign §6.4 / docs/ux/reading-lists.md), live against the hub.
   - "Favorites" is a client-synthesized system smart list (works.is_favorite):
     non-deletable, always starred, no manual order; "Remove" un-favorites.
   - Ordinary lists are CRUD via /api/reading-lists.
   - Covers are color blocks for now; R2 cover upload (200×200 crop) is deferred. */

const FAVORITES_ID = 'favorites'
type ListSort = 'manual' | 'added' | 'words' | 'title'
const SORT_LABELS: Record<ListSort, string> = {
  manual: 'Manual (position)', added: 'Added ↓', words: 'Words ↓', title: 'Title',
}

function favoritesList(memberIds: number[]): ReadingListRow {
  return { id: FAVORITES_ID, name: 'Favorites', description: 'Everything you’ve favorited', color: '#caa24a', autoPin: false, isSystem: true, starred: true, memberIds }
}
function sortLists(ls: ReadingListRow[]): ReadingListRow[] {
  return [...ls].sort((a, b) =>
    a.isSystem !== b.isSystem ? (a.isSystem ? -1 : 1)
    : a.starred !== b.starred ? (a.starred ? -1 : 1)
    : a.name.localeCompare(b.name))
}

export function ReadingLists() {
  const { works, update } = useLibrary()
  const [apiLists, setApiLists] = useState<ReadingListRow[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)

  const worksById = useMemo(() => new Map(works.map((w) => [w.workId, w])), [works])
  const favoriteIds = useMemo(() => works.filter((w) => w.isFavorite).map((w) => w.workId), [works])

  useEffect(() => {
    fetchReadingLists()
      .then((ls) => setApiLists(ls.filter((l) => !l.isSystem)))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false))
  }, [])

  const lists = useMemo(() => [favoritesList(favoriteIds), ...apiLists], [apiLists, favoriteIds])
  const open = openId == null ? null : lists.find((l) => l.id === openId) ?? null

  const replace = (row: ReadingListRow) => setApiLists((prev) => prev.map((l) => (l.id === row.id ? row : l)))
  const toggleStar = (l: ReadingListRow) => { if (!l.isSystem) patchReadingList(l.id, { starred: !l.starred }).then(replace).catch(reportErr) }
  const create = (p: { name: string; description?: string; starred: boolean }) =>
    createReadingList(p).then((row) => setApiLists((prev) => [...prev, row])).catch(reportErr)

  if (loading) return <Frame><p style={pad}>Loading…</p></Frame>
  if (error) return <Frame><p style={pad}>Couldn’t load: {error}</p></Frame>

  if (open) {
    return (
      <ListDetail
        list={open}
        worksById={worksById}
        onBack={() => setOpenId(null)}
        onReplace={replace}
        onDeleted={() => { setApiLists((p) => p.filter((l) => l.id !== open.id)); setOpenId(null) }}
        onUnfavorite={(ids) => ids.forEach((id) => update(id, { isFavorite: false }))}
        persist={(id, edit) => update(id, edit).then((err) => { if (err) reportErr(err) })}
      />
    )
  }
  return <ListIndex lists={lists} onOpen={setOpenId} onToggleStar={toggleStar} onCreate={create} />
}

function Frame({ children }: { children: ReactNode }) {
  return <div className="rl"><header className="rl__head"><h1 className="rl__title">Reading Lists</h1></header>{children}</div>
}

function StarBtn({ on, onClick, locked, className }: { on: boolean; onClick: () => void; locked?: boolean; className?: string }) {
  return (
    <button
      className={'rl__star' + (on ? ' is-on' : '') + (locked ? ' is-locked' : '') + (className ? ' ' + className : '')}
      onClick={(e) => { e.stopPropagation(); if (!locked) onClick() }}
      role="switch" aria-checked={on} disabled={locked}
      title={locked ? 'Always starred' : on ? 'Starred — shown as a Browse chip' : 'Star — show as a Browse chip'}
    >{on ? '★' : '☆'}</button>
  )
}

/* ------------------------------- Index ---------------------------------- */
function ListIndex({ lists, onOpen, onToggleStar, onCreate }: {
  lists: ReadingListRow[]; onOpen: (id: string) => void; onToggleStar: (l: ReadingListRow) => void
  onCreate: (p: { name: string; description?: string; starred: boolean }) => void
}) {
  const [creating, setCreating] = useState(false)
  return (
    <div className="rl">
      <header className="rl__head">
        <h1 className="rl__title">Reading Lists</h1>
        <Button variant="primary" size="sm" onClick={() => setCreating(true)} disabled={creating}>+ New list</Button>
      </header>

      <div className="rl__grid">
        {creating && (
          <CreateCard
            onCreate={(p) => { onCreate(p); setCreating(false) }}
            onCancel={() => setCreating(false)}
          />
        )}
        {sortLists(lists).map((l) => (
          <div key={l.id} className="rl__card" role="button" tabIndex={0}
            onClick={() => onOpen(l.id)}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(l.id) } }}>
            <Cover list={l}>
              <StarBtn on={l.starred} locked={l.isSystem} onClick={() => onToggleStar(l)} className="rl__star--cover" />
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

/* Inline new-list card: appears at the top of the grid in edit mode. Enter or
   clicking/tapping outside the card saves (empty name discards); Escape cancels.
   No save button. Image upload is a placeholder until R2 covers are wired. */
function CreateCard({ onCreate, onCancel }: {
  onCreate: (p: { name: string; description?: string; starred: boolean }) => void
  onCancel: () => void
}) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [starred, setStarred] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const done = useRef(false)

  const commit = () => {
    if (done.current) return
    done.current = true
    const n = name.trim()
    if (n) onCreate({ name: n, description: description.trim() || undefined, starred })
    else onCancel()
  }
  const cancel = () => { if (!done.current) { done.current = true; onCancel() } }
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') { e.preventDefault(); commit() }
    if (e.key === 'Escape') cancel()
  }

  useEffect(() => {
    const onDown = (e: PointerEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) commit() }
    document.addEventListener('pointerdown', onDown, true)
    return () => document.removeEventListener('pointerdown', onDown, true)
  })

  return (
    <div className="rl__card rl__card--create" ref={ref}>
      <div className="rl__cover" style={{ ['--list-color' as string]: 'var(--accent)' }}>
        <span className="rl__covername">{name || 'New list'}</span>
        <button
          className={'rl__star rl__star--cover' + (starred ? ' is-on' : '')}
          onClick={() => setStarred((s) => !s)}
          role="switch" aria-checked={starred}
          title={starred ? 'Starred — shown as a Browse chip' : 'Star — show as a Browse chip'}
        >{starred ? '★' : '☆'}</button>
        <span className="rl__coverpick" title="Cover upload coming soon" aria-hidden>📷</span>
      </div>
      <div className="rl__cardbody">
        <input className="rl__createname" autoFocus placeholder="List name" value={name}
          onChange={(e) => setName(e.target.value)} onKeyDown={onKey} />
        <input className="rl__createdesc" placeholder="Description (optional)" value={description}
          onChange={(e) => setDescription(e.target.value)} onKeyDown={onKey} />
      </div>
    </div>
  )
}

function Cover({ list, large, children }: { list: ReadingListRow; large?: boolean; children?: ReactNode }) {
  const empty = list.memberIds.length === 0
  const cls = 'rl__cover' + (large ? ' rl__cover--lg' : '') + (empty ? ' is-empty' : '')
  return (
    <div className={cls} style={{ ['--list-color' as string]: list.color ?? 'var(--accent)' }} aria-hidden>
      <span className="rl__covername">{list.name}</span>
      {empty && <span className="rl__coverempty">empty</span>}
      {children}
    </div>
  )
}

/* ------------------------------- Detail --------------------------------- */
function ListDetail({ list, worksById, onBack, onReplace, onDeleted, onUnfavorite, persist }: {
  list: ReadingListRow
  worksById: Map<number, Work>
  onBack: () => void
  onReplace: (row: ReadingListRow) => void
  onDeleted: () => void
  onUnfavorite: (ids: number[]) => void
  persist: (workId: number, edit: Parameters<ReturnType<typeof useLibrary>['update']>[1]) => void
}) {
  const system = list.isSystem
  const sortOptions: ListSort[] = system ? ['added', 'words', 'title'] : ['manual', 'added', 'words', 'title']
  const [sort, setSort] = useState<ListSort>(sortOptions[0])
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [dragId, setDragId] = useState<number | null>(null)
  const [overId, setOverId] = useState<number | null>(null)
  const [editTitle, setEditTitle] = useState(false)
  const [editDesc, setEditDesc] = useState(false)
  const [readerWork, setReaderWork] = useState<Work | null>(null)

  const patch = (p: Parameters<typeof patchReadingList>[1]) => patchReadingList(list.id, p).then(onReplace).catch(reportErr)
  const commitTitle = (v: string) => { const n = v.trim(); setEditTitle(false); if (n && n !== list.name) patch({ name: n }) }
  const commitDesc = (v: string) => { setEditDesc(false); patch({ description: v.trim() || null }) }

  const canReorder = sort === 'manual' && !system
  const members = useMemo(() => {
    const ws = list.memberIds.map((id) => worksById.get(id)).filter(Boolean) as Work[]
    if (sort === 'manual') return ws
    const arr = [...ws]
    if (sort === 'added') arr.reverse()
    if (sort === 'words') arr.sort((a, b) => b.wordcount - a.wordcount)
    if (sort === 'title') arr.sort((a, b) => a.title.localeCompare(b.title))
    return arr
  }, [list.memberIds, worksById, sort])

  const toggleSel = (id: number) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n })

  const reorder = (from: number, to: number) => {
    if (from === to) return
    const ids = [...list.memberIds]
    const fi = ids.indexOf(from); if (fi < 0) return
    ids.splice(fi, 1)
    const ti = ids.indexOf(to); if (ti < 0) return
    ids.splice(ti, 0, from)
    onReplace({ ...list, memberIds: ids })            // optimistic
    reorderListMembers(list.id, ids).then(onReplace).catch(reportErr)
  }

  const removeSelected = () => {
    const ids = [...selected]
    if (system) {
      if (!confirm(`Un-favorite ${ids.length} ${ids.length === 1 ? 'story' : 'stories'}? This also removes ${ids.length === 1 ? 'its' : 'their'} AO3 bookmark${ids.length === 1 ? '' : 's'}.`)) return
      setSelected(new Set())
      onUnfavorite(ids)
      return
    }
    setSelected(new Set())
    onReplace({ ...list, memberIds: list.memberIds.filter((id) => !selected.has(id)) })  // optimistic
    removeListMembers(list.id, ids).then(onReplace).catch(reportErr)
  }

  return (
    <div className="rl rl--detail">
      <button className="rl__back" onClick={onBack}>‹ Reading Lists</button>

      <header className="rl__dethead">
        <Cover list={list} large />
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
            <StarBtn on={list.starred} locked={system} onClick={() => patch({ starred: !list.starred })} className="rl__star--head" />
            {!system && (
              <button
                className={'rl__pin' + (list.autoPin ? ' is-on' : '')}
                onClick={() => patch({ auto_pin: !list.autoPin })}
                aria-pressed={list.autoPin}
                title={list.autoPin ? 'Pinned offline' : 'Pin for offline'}
              >{list.autoPin ? '📌' : '📍'}</button>
            )}
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
                {sortOptions.map((s) => (<option key={s} value={s}>{SORT_LABELS[s]}</option>))}
              </select>
            </label>
            {!system && <Button variant="ghost" size="sm" onClick={() => { if (confirm(`Delete “${list.name}”?`)) deleteReadingList(list.id).then(onDeleted).catch(reportErr) }}>Delete</Button>}
          </div>
        </div>
      </header>

      {selected.size > 0 && (
        <div className="rl__bulk" role="toolbar" aria-label="List member actions">
          <span className="rl__bulkcount">{selected.size} selected</span>
          <div className="rl__bulkactions">
            <button className="rl__bulkbtn" onClick={removeSelected}>
              {system ? 'Un-favorite' : 'Remove from list'}
            </button>
          </div>
          <button className="rl__bulkclear" onClick={() => setSelected(new Set())} aria-label="Clear selection">✕</button>
        </div>
      )}

      {members.length === 0 ? (
        <div className="rl__empty">No works in this list yet. Add from a story card’s <strong>+ List</strong>.</div>
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
                <span className="rl__grip" title="Drag to reorder" aria-label="Drag to reorder" draggable
                  onDragStart={(e) => { setDragId(w.workId); e.dataTransfer.effectAllowed = 'move' }}
                  onDragEnd={() => { setDragId(null); setOverId(null) }}>⠿</span>
              )}
              <div className="rl__membercard">
                <StoryCard work={w} selectable selected={selected.has(w.workId)} onSelect={() => toggleSel(w.workId)}
                  onRead={() => setReaderWork(w)}
                  onFavorite={(v) => persist(w.workId, { isFavorite: v })}
                  onPin={(v) => persist(w.workId, { pinned: v })}
                  onStatus={(st) => persist(w.workId, { readStatus: st })}
                  canAddToList />
              </div>
            </li>
          ))}
        </ol>
      )}

      {readerWork && <Reader work={readerWork} onClose={() => setReaderWork(null)} />}
    </div>
  )
}

const pad: React.CSSProperties = { padding: 'var(--space-4)', color: 'var(--text-muted)' }
function reportErr(e: unknown) { alert(`Save failed: ${e instanceof Error ? e.message : e}`) }
