/* Shared work-sort comparators, keyed by SORT_OPTIONS.label (mock/data.ts). Used by
   Browse and by Reading List detail so both surfaces sort by the same parameters.
   Dates compare on raw epoch-ms (the dateAdded/dateRead strings are display-formatted
   — never compare those). 'Surprise me' is intentionally a no-op (stable order). */
import type { Work } from './types'

export function comparator(label: string): (a: Work, b: Work) => number {
  switch (label) {
    case 'Date added — newest': return (a, b) => (b.dateAddedTs ?? 0) - (a.dateAddedTs ?? 0)
    case 'Date added — oldest': return (a, b) => (a.dateAddedTs ?? 0) - (b.dateAddedTs ?? 0)
    case 'Date read — newest': return (a, b) => (b.dateReadTs ?? 0) - (a.dateReadTs ?? 0)
    case 'Word count — high to low': return (a, b) => b.wordcount - a.wordcount
    case 'Word count — low to high': return (a, b) => a.wordcount - b.wordcount
    case 'Title — A to Z': return (a, b) => a.title.localeCompare(b.title)
    case 'Author — A to Z': return (a, b) => (a.authors[0] ?? '').localeCompare(b.authors[0] ?? '')
    default: return () => 0
  }
}
