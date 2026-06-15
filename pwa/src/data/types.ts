/* Canonical domain types for the wired app. Mirror the snapshot's per-work
   projection (redesign §12.3); the prototype's mock/data.ts uses the same shapes
   so components migrate to these unchanged (Phase F). */

export type ReadStatus = 'Unread' | 'Read' | 'DNF'
export type Rating = 'General' | 'Teen' | 'Mature' | 'Explicit' | 'Not Rated'
export type Availability = 'live' | 'deleted' | 'locked' | 'n/a'

export type Category =
  | 'Fandom' | 'Relationship' | 'Character'
  | 'Identity' | 'Universe' | 'ABO' | 'Content' | 'Trope' | 'Dynamics'
  | 'Mood' | 'Structure' | 'Other' | 'Rating'

export type Tag = { name: string; category: Category; grouped?: boolean; synonyms?: number }

export type Work = {
  workId: number
  title: string
  authors: string[]
  primaryShip: string | null
  primaryCollection: string | null
  wordcount: number
  chapterCount?: number
  isComplete?: boolean
  rating: Rating
  readStatus: ReadStatus
  isFavorite: boolean
  pinned: boolean
  availability: Availability
  source?: 'ao3' | 'pre_ao3'
  sourceUrl?: string
  language?: string
  dateAdded?: string
  dateRead?: string | null
  summary: string
  tags: Tag[]
  seriesName?: string | null
  seriesIndex?: number | null
}
