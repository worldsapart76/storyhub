import { useEffect, useRef, useState } from 'react'
import ePub, { type Book, type Rendition } from 'epubjs'
import './Reader.css'
import type { Work } from '../data/types'
import { fetchEpubBytes } from '../data/epub'

/* The in-app reader — renders the work's real epub (from R2) with epub.js (§5).
   Reading-specific theme (light/sepia/dark) is LOCAL to the reader and
   independent of the app theme. Paginated flow; prev/next move by page; the
   chapter menu jumps via the TOC. */

type ReaderTheme = 'light' | 'sepia' | 'dark'
const FONT_STEPS = [15, 17, 19, 21, 24] // px, maps to A− / A+
const MAXW = { narrow: '40em', wide: '60em' }
const THEME_BG: Record<ReaderTheme, { bg: string; fg: string }> = {
  light: { bg: '#ffffff', fg: '#1a1a1a' },
  sepia: { bg: '#f4ecd8', fg: '#5b4636' },
  dark: { bg: '#1a1a1a', fg: '#d4d4d4' },
}

function registerThemes(r: Rendition) {
  for (const [name, { bg, fg }] of Object.entries(THEME_BG)) {
    r.themes.register(name, {
      body: { background: `${bg} !important`, color: `${fg} !important`, 'line-height': '1.6' },
      a: { color: `${fg} !important` },
      'p, div, span, li': { color: `${fg} !important` },
    })
  }
}

/* themes.select() doesn't reliably re-skin already-rendered content (epub.js
   leaves the prior theme's body background), so also force the colors inline on
   the live iframe doc — inline !important beats the stale injected stylesheet. */
function applyTheme(r: Rendition | null, theme: ReaderTheme) {
  if (!r) return
  r.themes.select(theme)
  const { bg, fg } = THEME_BG[theme]
  try {
    ;(r.getContents() as any).forEach?.((c: any) => {
      const doc: Document = c.document
      for (const el of [doc.documentElement, doc.body]) {
        if (!el) continue
        el.style.setProperty('background', bg, 'important')
        el.style.setProperty('color', fg, 'important')
      }
    })
  } catch { /* contents not ready yet */ }
}

export function Reader({ work, onClose }: { work: Work; onClose: () => void }) {
  const hostRef = useRef<HTMLDivElement>(null)
  const bookRef = useRef<Book | null>(null)
  const rendRef = useRef<Rendition | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [toc, setToc] = useState<{ label: string; href: string }[]>([])
  const [fontIdx, setFontIdx] = useState(1)
  const [theme, setTheme] = useState<ReaderTheme>('sepia')
  const [wide, setWide] = useState(false)
  const [chapMenu, setChapMenu] = useState(false)
  const [pct, setPct] = useState(0)
  const [chap, setChap] = useState({ index: 0, total: 0 })
  const themeRef = useRef(theme)
  themeRef.current = theme

  // Load + render the epub once.
  useEffect(() => {
    let cancelled = false
    setLoading(true); setError(null)
    fetchEpubBytes(work.workId).then((res) => {
      if (cancelled) return
      if (typeof res === 'string') { setError(res); setLoading(false); return }
      const book = ePub(res as ArrayBuffer)
      bookRef.current = book
      const rendition = book.renderTo(hostRef.current!, {
        width: '100%', height: '100%', flow: 'paginated', spread: 'none', allowScriptedContent: false,
      })
      rendRef.current = rendition
      registerThemes(rendition)
      rendition.themes.fontSize(`${FONT_STEPS[fontIdx]}px`)
      rendition.display().then(() => { if (!cancelled) { applyTheme(rendition, themeRef.current); setLoading(false) } })

      book.loaded.navigation.then((nav) => {
        if (!cancelled) setToc(nav.toc.map((t) => ({ label: t.label.trim(), href: t.href })))
      })
      const spineCount = () => (book.spine as any).length ?? (book.spine as any).spineItems?.length ?? 0
      book.ready.then(() => {
        if (!cancelled) setChap((c) => ({ ...c, total: spineCount() }))
      })
      rendition.on('relocated', (loc: any) => {
        if (cancelled) return
        setPct(loc.start.percentage ?? 0)
        setChap({ index: (loc.start.index ?? 0) + 1, total: spineCount() })
        applyTheme(rendition, themeRef.current)   // keep freshly-rendered pages themed
      })
    }).catch((e) => { if (!cancelled) { setError(e instanceof Error ? e.message : String(e)); setLoading(false) } })

    return () => {
      cancelled = true
      try { rendRef.current?.destroy() } catch { /* ignore */ }
      try { bookRef.current?.destroy() } catch { /* ignore */ }
    }
  }, [work.workId])

  // React the live controls onto the rendition.
  useEffect(() => { rendRef.current?.themes.fontSize(`${FONT_STEPS[fontIdx]}px`) }, [fontIdx])
  useEffect(() => { applyTheme(rendRef.current, theme) }, [theme])
  // Width change: the host max-width changed; nudge epub.js to reflow to it.
  useEffect(() => {
    const id = setTimeout(() => window.dispatchEvent(new Event('resize')), 0)
    return () => clearTimeout(id)
  }, [wide])

  // Keyboard paging.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') rendRef.current?.next()
      else if (e.key === 'ArrowLeft') rendRef.current?.prev()
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const goChapter = (href: string) => { rendRef.current?.display(href); setChapMenu(false) }

  return (
    <div className="reader" data-reader-theme={theme} role="dialog" aria-label={`Reading ${work.title}`}>
      <header className="reader__bar">
        <button className="reader__close" onClick={onClose} aria-label="Close reader">✕</button>
        <div className="reader__titlewrap"><div className="reader__title">{work.title}</div></div>

        <div className="reader__chapwrap">
          <button className="reader__chapbtn" onClick={() => setChapMenu((o) => !o)} aria-haspopup="listbox" aria-expanded={chapMenu} disabled={!toc.length}>
            {chap.total ? `Ch ${chap.index} / ${chap.total}` : 'Contents'} ▾
          </button>
          {chapMenu && (
            <>
              <div className="reader__menuscrim" onClick={() => setChapMenu(false)} />
              <ul className="reader__chapmenu" role="listbox">
                {toc.map((t, i) => (
                  <li key={i}><button className="reader__chapitem" onClick={() => goChapter(t.href)}>{t.label}</button></li>
                ))}
              </ul>
            </>
          )}
        </div>
      </header>

      <div className="reader__controls">
        <div className="reader__ctrlgroup" role="group" aria-label="Font size">
          <button className="reader__ctrl" onClick={() => setFontIdx((i) => Math.max(0, i - 1))} disabled={fontIdx === 0} aria-label="Smaller text">A−</button>
          <button className="reader__ctrl" onClick={() => setFontIdx((i) => Math.min(FONT_STEPS.length - 1, i + 1))} disabled={fontIdx === FONT_STEPS.length - 1} aria-label="Larger text">A+</button>
        </div>
        <button className={'reader__ctrl' + (wide ? ' is-on' : '')} onClick={() => setWide((w) => !w)}>{wide ? 'Wide' : 'Narrow'}</button>
        <div className="reader__ctrlgroup" role="group" aria-label="Reader theme">
          {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((t) => (
            <button key={t} className={'reader__swatch reader__swatch--' + t + (theme === t ? ' is-on' : '')}
              onClick={() => setTheme(t)} aria-label={t} aria-pressed={theme === t} />
          ))}
        </div>
      </div>

      <div className="reader__stage">
        {loading && <div className="reader__status">Loading…</div>}
        {error && <div className="reader__status">{error}</div>}
        <div className="reader__epub" ref={hostRef} style={{ maxWidth: wide ? MAXW.wide : MAXW.narrow, visibility: loading || error ? 'hidden' : 'visible' }} />
        {!loading && !error && (
          <>
            <button className="reader__tap reader__tap--prev" aria-label="Previous page" onClick={() => rendRef.current?.prev()} />
            <button className="reader__tap reader__tap--next" aria-label="Next page" onClick={() => rendRef.current?.next()} />
          </>
        )}
      </div>

      <footer className="reader__foot">
        <button className="reader__nav" onClick={() => rendRef.current?.prev()} disabled={!!error}>◀ Prev</button>
        <div className="reader__progress">
          <div className="reader__progressbar"><span style={{ width: `${Math.round(pct * 100)}%` }} /></div>
          <span className="reader__progresslabel">{Math.round(pct * 100)}%{chap.total ? ` · Ch ${chap.index} of ${chap.total}` : ''}</span>
        </div>
        <button className="reader__nav" onClick={() => rendRef.current?.next()} disabled={!!error}>Next ▶</button>
      </footer>
    </div>
  )
}
