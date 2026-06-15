/* Map the snapshot's precomputed work_cards rows into Work objects. Columns are
   selected in a fixed order so the row maps positionally. */

import type { Database } from 'sql.js'
import type { Availability, Rating, ReadStatus, Tag, Work } from './types'

const COLUMNS =
  'work_id, title, authors, primary_ship, primary_collection, wordcount, ' +
  'chapter_count, is_complete, rating, read_status, is_favorite, pinned, ' +
  'availability, source, source_url, language, date_added, date_read, ' +
  'summary_html, tags'

function parseJson<T>(v: unknown, fallback: T): T {
  try {
    return v ? (JSON.parse(v as string) as T) : fallback
  } catch {
    return fallback
  }
}

function stripHtml(s: unknown): string {
  if (!s) return ''
  return String(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function toWork(r: unknown[]): Work {
  return {
    workId: Number(r[0]),
    title: (r[1] as string) ?? '',
    authors: parseJson<string[]>(r[2], []),
    primaryShip: (r[3] as string) ?? null,
    primaryCollection: (r[4] as string) ?? null,
    wordcount: Number(r[5] ?? 0),
    chapterCount: r[6] == null ? undefined : Number(r[6]),
    isComplete: r[7] == null ? undefined : Boolean(r[7]),
    rating: ((r[8] as string) ?? 'Not Rated') as Rating,
    readStatus: ((r[9] as string) ?? 'Unread') as ReadStatus,
    isFavorite: Boolean(r[10]),
    pinned: Boolean(r[11]),
    availability: ((r[12] as string) ?? 'live') as Availability,
    source: (r[13] as Work['source']) ?? undefined,
    sourceUrl: (r[14] as string) ?? undefined,
    language: (r[15] as string) ?? undefined,
    dateAdded: (r[16] as string) ?? undefined,
    dateRead: (r[17] as string) ?? null,
    summary: stripHtml(r[18]),
    tags: parseJson<Tag[]>(r[19], []),
  }
}

export function readWorks(db: Database): Work[] {
  const res = db.exec(`SELECT ${COLUMNS} FROM work_cards`)
  return res.length ? res[0].values.map(toWork) : []
}
