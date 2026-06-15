import { useState } from 'react'
import { hasToken } from './data/config'
import { LibraryProvider, useLibrary } from './data/library'
import { TokenGate } from './components/TokenGate'
import { NavShell } from './components/NavShell'
import { BrowseView } from './components/BrowseView'
import { ReadingLists } from './components/ReadingLists'
import { SavedFilters } from './components/SavedFilters'
import { TagManagement } from './components/TagManagement'
import { SyncView } from './components/SyncView'
import { ReviewQueue } from './components/ReviewQueue'

/* Active-surface router. Browse is wired to real data (Phase F4); the rest still
   render their prototype until their own wiring chunks. */
function surface(active: string) {
  switch (active) {
    case 'browse': return <BrowseView />
    case 'lists': return <ReadingLists />
    case 'filters': return <SavedFilters />
    case 'tags': return <TagManagement />
    case 'sync': return <SyncView />
    case 'review': return <ReviewQueue />
    default: return <BrowseView />
  }
}

function AppInner({ onReauth }: { onReauth: () => void }) {
  const [active, setActive] = useState('browse')
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
  return <NavShell active={active} onNavigate={setActive}>{surface(active)}</NavShell>
}

export function App() {
  const [authed, setAuthed] = useState(hasToken())
  if (!authed) return <TokenGate onConnected={() => setAuthed(true)} />
  return (
    <LibraryProvider>
      <AppInner onReauth={() => setAuthed(false)} />
    </LibraryProvider>
  )
}

const center: React.CSSProperties = {
  display: 'grid', placeItems: 'center', gap: 10, minHeight: '100vh', textAlign: 'center',
}
