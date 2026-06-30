/* Canonical domain types for the wired app. Mirror the snapshot's per-work
   projection (redesign §12.3); the prototype's mock/data.ts uses the same shapes
   so components migrate to these unchanged (Phase F). */

export type ReadStatus = 'Unread' | 'Read' | 'DNF'
export type Rating = 'General' | 'Teen' | 'Mature' | 'Explicit' | 'Not Rated'
export type Availability = 'live' | 'deleted' | 'locked' | 'n/a'

export type Category =
  | 'Fandom' | 'Relationship' | 'Character' | 'Trait'
  | 'Identity' | 'Universe' | 'Content' | 'Trope' | 'Dynamics'
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
  /* Raw epoch-ms for correct chronological sort/filter; the dateAdded/dateRead
     strings above are display-formatted and must never be compared. */
  dateAddedTs?: number
  dateReadTs?: number
  summary: string
  /* User's freeform private note (who recommended it, why to read it, etc.).
     Written via PATCH; surfaced on the story card. */
  personalNotes?: string | null
  tags: Tag[]
  seriesName?: string | null
  seriesIndex?: number | null
  /* Assembled at render time (BrowseView) from seriesName grouping, not stored in
     the snapshot: the work's series with all in-library siblings (full Works, so a
     row can expand into a real card) and which siblings match the active filter.
     Only set when ≥2 library works share the series. */
  series?: {
    name: string
    index: number
    total: number
    siblings: Work[]
    matchIds: number[]
  }
}
