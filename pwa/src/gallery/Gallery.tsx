import { useState } from 'react'
import './Gallery.css'
import { DeviceFrame, type Viewport } from './DeviceFrame'
import type { GalleryEntry } from './registry'
import { Foundations } from './pages/Foundations'
import { KitElements } from './pages/KitElements'
import { KitCard } from './pages/KitCard'
import { KitShell } from './pages/KitShell'
import { BrowseSurface } from './pages/BrowseSurface'
import { KitReader } from './pages/KitReader'
import { ReviewSurface } from './pages/ReviewSurface'
import { TagsSurface } from './pages/TagsSurface'
import { ReadingListsSurface } from './pages/ReadingListsSurface'
import { SavedFiltersSurface } from './pages/SavedFiltersSurface'
import { SyncSurface } from './pages/SyncSurface'
import { ExtensionSurface } from './pages/ExtensionSurface'

/* ---------------------------------------------------------------------------
   Gallery registry. Adding a component or surface = one entry here.
   present: 'fluid' fills the canvas; 'frame' wraps in the selected device frame
   (use 'frame' for anything responsive so the viewport toggle is meaningful).
   Surface pages (Step 3) get appended under the 'Surfaces' group.
   ------------------------------------------------------------------------- */
const ENTRIES: GalleryEntry[] = [
  { id: 'foundations', title: 'Foundations', group: 'Foundations', present: 'fluid', render: () => <Foundations /> },
  { id: 'kit-elements', title: 'Elements', group: 'Components', present: 'frame', render: () => <KitElements /> },
  { id: 'kit-card', title: 'Story card', group: 'Components', present: 'frame', render: () => <KitCard /> },
  { id: 'kit-shell', title: 'Nav shell', group: 'Components', present: 'frame', render: () => <KitShell /> },
  { id: 'kit-reader', title: 'In-app reader', group: 'Components', present: 'frame', render: () => <KitReader /> },
  { id: 'surface-browse', title: 'Browse', group: 'Surfaces', present: 'frame', render: () => <BrowseSurface /> },
  { id: 'surface-review', title: 'Review Queue', group: 'Surfaces', present: 'frame', render: () => <ReviewSurface /> },
  { id: 'surface-tags', title: 'Tag Management', group: 'Surfaces', present: 'frame', render: () => <TagsSurface /> },
  { id: 'surface-lists', title: 'Reading Lists', group: 'Surfaces', present: 'frame', render: () => <ReadingListsSurface /> },
  { id: 'surface-filters', title: 'Saved Filters', group: 'Surfaces', present: 'frame', render: () => <SavedFiltersSurface /> },
  { id: 'surface-sync', title: 'Sync', group: 'Surfaces', present: 'frame', render: () => <SyncSurface /> },
  { id: 'surface-extension', title: 'Extension (on AO3)', group: 'Surfaces', present: 'frame', render: () => <ExtensionSurface /> },
]

type Theme = 'light' | 'dark'

export function Gallery() {
  const [activeId, setActiveId] = useState(ENTRIES[0].id)
  const [theme, setTheme] = useState<Theme>('light')
  const [viewport, setViewport] = useState<Viewport>('desktop')

  const active = ENTRIES.find((e) => e.id === activeId) ?? ENTRIES[0]
  const groups = ['Foundations', 'Components', 'Surfaces'] as const

  return (
    <div className="gallery" data-theme={theme}>
      {/* Toolbar */}
      <header className="gallery__bar">
        <div className="gallery__brand">
          StoryHub <span className="gallery__tag">design prototype · unwired</span>
        </div>
        <div className="gallery__controls">
          <Segmented
            label="Viewport"
            value={viewport}
            options={[
              ['desktop', 'Desktop'],
              ['tablet', 'Tablet'],
              ['phone', 'Phone'],
            ]}
            onChange={(v) => setViewport(v as Viewport)}
          />
          <Segmented
            label="Theme"
            value={theme}
            options={[
              ['light', 'Light'],
              ['dark', 'Dark'],
            ]}
            onChange={(v) => setTheme(v as Theme)}
          />
        </div>
      </header>

      <div className="gallery__body">
        {/* Sidebar nav */}
        <nav className="gallery__nav">
          {groups.map((g) => {
            const items = ENTRIES.filter((e) => e.group === g)
            if (items.length === 0) return null
            return (
              <div key={g} className="gallery__navgroup">
                <div className="gallery__navhead">{g}</div>
                {items.map((e) => (
                  <button
                    key={e.id}
                    className={'gallery__navitem' + (e.id === activeId ? ' is-active' : '')}
                    onClick={() => setActiveId(e.id)}
                  >
                    {e.title}
                  </button>
                ))}
              </div>
            )
          })}
        </nav>

        {/* Canvas */}
        <main className="gallery__canvas" data-theme={theme}>
          {active.present === 'fluid' ? (
            <div className="gallery__fluid">{active.render()}</div>
          ) : (
            <div className="gallery__stage">
              <DeviceFrame viewport={viewport}>{active.render()}</DeviceFrame>
            </div>
          )}
        </main>
      </div>
    </div>
  )
}

function Segmented({
  label,
  value,
  options,
  onChange,
}: {
  label: string
  value: string
  options: [string, string][]
  onChange: (v: string) => void
}) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map(([val, text]) => (
        <button
          key={val}
          className={'seg__btn' + (val === value ? ' is-on' : '')}
          onClick={() => onChange(val)}
        >
          {text}
        </button>
      ))}
    </div>
  )
}
