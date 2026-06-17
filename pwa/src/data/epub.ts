/* Per-work file actions. The epub lives in R2 behind the authed hub endpoint
   (/api/works/{id}/epub), so a plain <a href> can't fetch it — we pull the bytes
   with the bearer token and hand the blob to the browser. AO3 is a public URL. */

import { authHeaders, getHub } from './config'
import type { Work } from './types'

export function ao3Url(work: Pick<Work, 'workId' | 'sourceUrl'>): string | null {
  if (work.sourceUrl) return work.sourceUrl
  // Positive ids are real AO3 work ids; negatives are pre-AO3 with no live page.
  return work.workId > 0 ? `https://archiveofourown.org/works/${work.workId}` : null
}

export function openAo3(work: Pick<Work, 'workId' | 'sourceUrl'>): void {
  const url = ao3Url(work)
  if (url) window.open(url, '_blank', 'noopener')
}

/* Fetch the epub bytes for in-app rendering (epub.js takes an ArrayBuffer).
   Returns the buffer, or a user-facing error string. */
export async function fetchEpubBytes(workId: number): Promise<ArrayBuffer | string> {
  try {
    const res = await fetch(`${getHub()}/api/works/${workId}/epub`, { headers: authHeaders() })
    if (!res.ok) return res.status === 404 ? 'No epub stored for this work.' : `Couldn’t load epub (${res.status}).`
    return await res.arrayBuffer()
  } catch (e) {
    return e instanceof Error ? e.message : 'Network error.'
  }
}

function epubFilename(title?: string): string {
  return `${(title || 'work').replace(/[<>:"/\\|?*]/g, '').trim().slice(0, 120) || 'work'}.epub`
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 10_000)
}

/* "Open" the epub: hand it to the OS via the Web Share sheet (so you can send it
   straight to an epub app), falling back to a download where share-with-files
   isn't supported (e.g. some desktop browsers). Returns an error string, or null.
   (In-app reading is "Read here" — this is the external hand-off.) */
export async function openEpub(work: Pick<Work, 'workId' | 'title'>): Promise<string | null> {
  try {
    const res = await fetch(`${getHub()}/api/works/${work.workId}/epub`, { headers: authHeaders() })
    if (!res.ok) return res.status === 404 ? 'No epub stored for this work.' : `Couldn’t fetch epub (${res.status}).`
    const blob = await res.blob()
    const filename = epubFilename(work.title)
    const file = new File([blob], filename, { type: 'application/epub+zip' })

    const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean }
    if (nav.canShare?.({ files: [file] })) {
      try {
        await nav.share({ files: [file], title: work.title } as ShareData)
        return null
      } catch (e) {
        if ((e as DOMException)?.name === 'AbortError') return null // user dismissed the sheet
        // any other share error → fall through to download
      }
    }
    triggerDownload(blob, filename)
    return null
  } catch (e) {
    return e instanceof Error ? e.message : 'Failed to open epub.'
  }
}
