import { useState } from 'react'
import { hasToken } from './data/config'
import { LibraryProvider, useLibrary } from './data/library'
import { NavProvider, useNav } from './data/appnav'
import { useTheme } from './data/theme'
import { TokenGate } from './components/TokenGate'
import { NavShell } from './components/NavShell'
import { BrowseView } from './components/BrowseView'
import { ReadingLists } from './components/ReadingLists'
import { SavedFilters } from './components/SavedFilters'
import { TagManagement } from './components/TagManagement'
import { SyncView } from './components/SyncView'
import { ReviewQueue } from './components/ReviewQueue'
import { Settings } from './components/Settings'

/* Active-surface router. Browse is wired to real data (Phase F4); the rest still
   render their prototype until their own wiring chunks. */
function surface(active: string, theme: 'light' | 'dark', onToggleTheme: () => void) {
  switch (active) {
    case 'browse': return <BrowseView />
    case 'lists': return <ReadingLists />
    case 'filters': return <SavedFilters />
    case 'tags': return <TagManagement />
    case 'sync': return <SyncView />
    case 'review': return <ReviewQueue />
    case 'settings': return <Settings theme={theme} onToggleTheme={onToggleTheme} />
    default: return <BrowseView />
  }
}

function AppInner({ onReauth, theme, onToggleTheme }: { onReauth: () => void; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const { active, navigate } = useNav()
  const lib = useLibrary()

  if (lib.loading) return <div style={center}>Loading library…</div>
  if (lib.error === 'AUTH') { onReauth(); return null }
  if (lib.error) {
    return (
      <div style={center}>
        <div>Couldn’t load the library.</div>
        <div style={{ opacity: 0.7, fontSize: 13 }}>{lib.error}</div>
        <button onClick={lib.reload}>Retry</button>
      </div>
    )
  }
  return <NavShell active={active} onNavigate={navigate} theme={theme} onToggleTheme={onToggleTheme} pending={lib.pending}>{surface(active, theme, onToggleTheme)}</NavShell>
}

export function App() {
  const [authed, setAuthed] = useState(hasToken())
  const { theme, toggle } = useTheme()
  if (!authed) return <TokenGate onConnected={() => setAuthed(true)} />
  return (
    <LibraryProvider>
      <NavProvider>
        <AppInner onReauth={() => setAuthed(false)} theme={theme} onToggleTheme={toggle} />
      </NavProvider>
    </LibraryProvider>
  )
}

const center: React.CSSProperties = {
  display: 'grid', placeItems: 'center', gap: 10, minHeight: '100vh', textAlign: 'center',
}
