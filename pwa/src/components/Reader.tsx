import { useState } from 'react'
import './Reader.css'
import { type Work, READER_SAMPLE } from '../mock/data'

/* The in-app reader — the universal fallback for "open" when OS hand-off is
   awkward (§5). Renders the stored epub in the real app; mock prose here so the
   reading typography + controls can be designed. Full-bleed overlay over the
   detail view. Reading-specific theme (light/sepia/dark) is LOCAL to the reader
   and independent of the app theme — you read in sepia at night regardless. */

type ReaderTheme = 'light' | 'sepia' | 'dark'
const FONT_STEPS = [15, 17, 19, 21, 24] // px, maps to A− / A+
const WIDTHS = { narrow: 32, wide: 46 } // ch

export function Reader({ work, onClose }: { work: Work; onClose: () => void }) {
  const chapters = READER_SAMPLE
  const [ch, setCh] = useState(0)
  const [fontIdx, setFontIdx] = useState(1)
  const [theme, setTheme] = useState<ReaderTheme>('sepia')
  const [wide, setWide] = useState(false)
  const [chapMenu, setChapMenu] = useState(false)

  const total = work.chapterCount ?? chapters.length
  const chapter = chapters[Math.min(ch, chapters.length - 1)]
  const atFirst = ch === 0
  const atLast = ch >= chapters.length - 1

  return (
    <div className="reader" data-reader-theme={theme} role="dialog" aria-label={`Reading ${work.title}`}>
      <header className="reader__bar">
        <button className="reader__close" onClick={onClose} aria-label="Close reader">✕</button>
        <div className="reader__titlewrap">
          <div className="reader__title">{work.title}</div>
        </div>

        <div className="reader__chapwrap">
          <button className="reader__chapbtn" onClick={() => setChapMenu((o) => !o)} aria-haspopup="listbox" aria-expanded={chapMenu}>
            Ch {ch + 1} / {total} ▾
          </button>
          {chapMenu && (
            <>
              <div className="reader__menuscrim" onClick={() => setChapMenu(false)} />
              <ul className="reader__chapmenu" role="listbox">
                {chapters.map((c, i) => (
                  <li key={i}>
                    <button
                      className={'reader__chapitem' + (i === ch ? ' is-on' : '')}
                      onClick={() => { setCh(i); setChapMenu(false) }}
                    >
                      {c.title}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </header>

      {/* Reading controls: font size, column width, reader theme */}
      <div className="reader__controls">
        <div className="reader__ctrlgroup" role="group" aria-label="Font size">
          <button className="reader__ctrl" onClick={() => setFontIdx((i) => Math.max(0, i - 1))} disabled={fontIdx === 0} aria-label="Smaller text">A−</button>
          <button className="reader__ctrl" onClick={() => setFontIdx((i) => Math.min(FONT_STEPS.length - 1, i + 1))} disabled={fontIdx === FONT_STEPS.length - 1} aria-label="Larger text">A+</button>
        </div>
        <button className={'reader__ctrl' + (wide ? ' is-on' : '')} onClick={() => setWide((w) => !w)}>
          {wide ? 'Wide' : 'Narrow'}
        </button>
        <div className="reader__ctrlgroup" role="group" aria-label="Reader theme">
          {(['light', 'sepia', 'dark'] as ReaderTheme[]).map((t) => (
            <button
              key={t}
              className={'reader__swatch reader__swatch--' + t + (theme === t ? ' is-on' : '')}
              onClick={() => setTheme(t)}
              aria-label={t}
              aria-pressed={theme === t}
            />
          ))}
        </div>
      </div>

      <div className="reader__scroll">
        <article
          className="reader__page"
          style={{ fontSize: FONT_STEPS[fontIdx], maxWidth: `${wide ? WIDTHS.wide : WIDTHS.narrow}em` }}
        >
          <h2 className="reader__chaphead">{chapter.title}</h2>
          {chapter.paras.map((p, i) => (
            <p key={i} className="reader__para">{p}</p>
          ))}
        </article>
      </div>

      <footer className="reader__foot">
        <button className="reader__nav" onClick={() => setCh((c) => Math.max(0, c - 1))} disabled={atFirst}>◀ Prev</button>
        <div className="reader__progress">
          <div className="reader__progressbar"><span style={{ width: `${((ch + 1) / total) * 100}%` }} /></div>
          <span className="reader__progresslabel">Chapter {ch + 1} of {total}</span>
        </div>
        <button className="reader__nav" onClick={() => setCh((c) => Math.min(chapters.length - 1, c + 1))} disabled={atLast}>Next ▶</button>
      </footer>
    </div>
  )
}
