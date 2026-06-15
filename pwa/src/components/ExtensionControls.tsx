import { useState } from 'react'
import './ExtensionControls.css'
import { EXT_WORK, type LibraryState, type ReadStatus } from '../mock/data'

/* Extension injected controls (redesign §12.1–12.2). A MOCK AO3 work page in the
   user's dark skin, so the StoryHub bits the extension injects can be reviewed in
   context. Host chrome = AO3's own look; the one StoryHub-injected control (DNF)
   and the status badge are tinted indigo + tagged ◆.

   Interaction model (corrected to §12.2):
   - The extension HOOKS AO3's own buttons — there is NO separate "Add" button.
     * Mark for Later → capture (add + download epub); the SAME control reads
       "Mark as Read" once listed → Read.
     * Bookmark → Favorite. AO3's Bookmark button only navigates to a form, so the
       extension INTERCEPTS it and creates the private bookmark via a background
       authenticated request (no navigation). Clicking again removes it.
   - DNF is the one injected control: capture-if-needed + DNF + mark-read on AO3.
   - Side-effects from the app drain AUTOMATICALLY in the background on AO3 page
     loads (no banner here); failures surface in the Sync view. */

function StatusBadge({ state }: { state: LibraryState }) {
  if (!state.inLibrary) return null
  return (
    <span className="sh-titlebadge">
      <span className="sh-mark" aria-hidden>◆</span>
      <span className={'sh-badge sh-badge--' + state.status.toLowerCase()}>{state.status}</span>
      {state.favorite && <span className="sh-fav" title="Favorite (private bookmark on AO3)">★</span>}
    </span>
  )
}

const BODY = [
  'The sunset over the cityscape painted the harsh lines of the buildings in soft pinks and oranges, little patches of beauty between the daggers of blackness. Wind stirred the leaves on the concrete, dancing in what was left of the daylight.',
  'Geralt had crossed the Continent twice over and drawn a map of every mile, but there was one road he kept leaving off the page — and Jaskier, damn him, had finally started asking why.',
]

export function ExtensionControls() {
  const [state, setState] = useState<LibraryState>({ inLibrary: false })

  const ensure = (next: Partial<{ status: ReadStatus; favorite: boolean }>) =>
    setState((s) => {
      const base = s.inLibrary ? s : { inLibrary: true as const, status: 'Unread' as ReadStatus, favorite: false }
      return { ...base, ...next }
    })

  // Native "Mark for Later" ⇄ "Mark as Read" toggle (the extension hooks it).
  const mflLabel = !state.inLibrary || state.status !== 'Unread' ? 'Mark for Later' : 'Mark as Read'
  const onMfl = () => {
    if (!state.inLibrary) setState({ inLibrary: true, status: 'Unread', favorite: false }) // capture + download
    else if (state.status === 'Unread') ensure({ status: 'Read' })                          // Mark as Read
    else ensure({ status: 'Unread' })                                                       // re-mark for later
  }
  // Native "Bookmark" — intercepted: background private bookmark = Favorite.
  const favorited = state.inLibrary && state.favorite
  const onBookmark = () => (favorited ? ensure({ favorite: false }) : ensure({ favorite: true, status: 'Read' }))
  const onDnf = () => ensure({ status: 'DNF' })

  const w = EXT_WORK
  const tag = (t: string) => <a key={t} className="ao3-tag">{t}</a>

  return (
    <div className="ao3">
      {/* AO3 site header (two rows, dark skin) */}
      <div className="ao3-topbar">
        <span className="ao3-logo"><span className="ao3-logomark" aria-hidden>✦</span> Archive of Our Own</span>
        <span className="ao3-greeting">Hi, worldsapart! &nbsp; Post &nbsp; Log Out</span>
      </div>
      <div className="ao3-navbar">
        <nav className="ao3-nav"><span>Fandoms</span><span>Browse</span><span>Search</span><span>About</span></nav>
        <span className="ao3-searchbox"><span className="ao3-searchinput" /><span className="ao3-searchbtn">Search</span></span>
      </div>

      <div className="ao3-page">
        {/* AO3 action-button row (right-aligned). Mark for Later + Bookmark are
            hooked by the extension; DNF is the one injected control (◆). */}
        <div className="ao3-actions">
          <a className={'ao3-btn' + (mflLabel === 'Mark as Read' ? ' is-hooked-active' : '')} onClick={onMfl}>{mflLabel}</a>
          <a className="ao3-btn">Comments</a>
          <a className={'ao3-btn' + (favorited ? ' is-hooked-active' : '')} onClick={onBookmark}>{favorited ? 'Edit Bookmark' : 'Bookmark'}</a>
          <a className="ao3-btn">Subscribe</a>
          <a className="ao3-btn">Share</a>
          <a className="ao3-btn">Download ↓</a>
          <button className="sh-dnf" onClick={onDnf} disabled={state.inLibrary && state.status === 'DNF'}>
            <span className="sh-mark" aria-hidden>◆</span> DNF
          </button>
        </div>

        {/* AO3 work meta box */}
        <dl className="ao3-meta">
          <dt>Rating:</dt><dd>{tag(w.rating)}</dd>
          <dt>Archive Warning:</dt><dd>{w.warnings.map(tag)}</dd>
          <dt>Category:</dt><dd>{w.categories.map(tag)}</dd>
          <dt>Fandom:</dt><dd>{w.fandoms.map(tag)}</dd>
          <dt>Relationships:</dt><dd>{w.relationships.map(tag)}</dd>
          <dt>Characters:</dt><dd>{w.characters.map(tag)}</dd>
          <dt>Additional Tags:</dt><dd>{w.additionalTags.map(tag)}</dd>
          <dt>Language:</dt><dd>{w.language}</dd>
          <dt>Series:</dt><dd><span className="ao3-seriestext">Part 2 of </span><a className="ao3-tag">{w.series.replace(/^Part \d+ of /, '')}</a></dd>
          <dt>Stats:</dt><dd className="ao3-stats">
            Published: {w.published} &nbsp; Words: {w.words.toLocaleString()} &nbsp; Chapters: {w.chapters} &nbsp;
            Comments: {w.comments} &nbsp; Kudos: {w.kudos.toLocaleString()} &nbsp; Bookmarks: {w.bookmarks} &nbsp; Hits: {w.hits.toLocaleString()}
          </dd>
        </dl>

        {/* AO3 centered preface — StoryHub badge sits beside the title */}
        <div className="ao3-preface">
          <h2 className="ao3-title">
            {w.title}
            <StatusBadge state={state} />
          </h2>
          <h3 className="ao3-byline"><a className="ao3-link">{w.authors.join(', ')}</a></h3>
          <div className="ao3-summary">
            <p className="ao3-summaryhead">Summary:</p>
            <blockquote>{w.summary}</blockquote>
          </div>
        </div>

        {/* Work text begins */}
        <div className="ao3-body">
          <h4 className="ao3-chapter">Chapter 1: The Road Not Charted</h4>
          {BODY.map((p, i) => <p key={i}>{p}</p>)}
        </div>
      </div>
    </div>
  )
}
