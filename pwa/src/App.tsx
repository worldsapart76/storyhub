import { useEffect, useState } from 'react'
import { hasToken } from './data/config'
import { fetchReviewCount } from './data/review'
import { fetchPendingCount, requestCapture } from './data/pending'
import { consumeSharedUrl } from './data/share'
import { toast } from './data/toast'
import { LibraryProvider, useLibrary } from './data/library'
import { clearCachedSnapshot } from './data/idb'
import { NavProvider, useNav } from './data/appnav'
import { useTheme } from './data/theme'
import { TokenGate } from './components/TokenGate'
import { NavShell } from './components/NavShell'
import { Toaster } from './components/Toaster'
import { BrowseView } from './components/BrowseView'
import { ReadingLists } from './components/ReadingLists'
import { SavedFilters } from './components/SavedFilters'
import { TagManagement } from './components/TagManagement'
import { SyncView } from './components/SyncView'
import { StatsView } from './components/StatsView'
import { ReviewQueue } from './components/ReviewQueue'
import { PendingView } from './components/PendingView'
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
    case 'stats': return <StatsView />
    case 'review': return <ReviewQueue />
    case 'pending': return <PendingView />
    case 'settings': return <Settings theme={theme} onToggleTheme={onToggleTheme} />
    default: return <BrowseView />
  }
}

function AppInner({ onReauth, theme, onToggleTheme }: { onReauth: () => void; theme: 'light' | 'dark'; onToggleTheme: () => void }) {
  const { active, navigate } = useNav()
  const lib = useLibrary()
  const [reviewCount, setReviewCount] = useState<number | undefined>(undefined)
  const [pendingCount, setPendingCount] = useState<number | undefined>(undefined)

  // A share-target launch (/share?url=…) lands here once we're authed: add the
  // shared work, surface the result, and drop the user on the Pending page.
  useEffect(() => {
    const shared = consumeSharedUrl()
    if (!shared) return
    requestCapture(shared)
      .then((r) => {
        if (r.status === 'queued') toast(`Queued work ${r.work_id} — fetch it on your PC`, 'ok')
        else if (r.status === 'already_queued') toast(`Work ${r.work_id} is already queued`, 'warn')
        else toast(`Work ${r.work_id} is already in your library`, 'warn')
        navigate('pending')
      })
      .catch((e) => toast(`Add failed: ${e instanceof Error ? e.message : e}`, 'err'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Refresh the sidebar badges on load and whenever the surface changes (so acting
  // somewhere then navigating updates the counts).
  useEffect(() => {
    let live = true
    fetchReviewCount().then((n) => { if (live) setReviewCount(n) }).catch(() => {})
    fetchPendingCount().then((n) => { if (live) setPendingCount(n) }).catch(() => {})
    return () => { live = false }
  }, [active])

  if (lib.loading) return <div style={center}>Loading library…</div>
  if (lib.error === 'AUTH') { onReauth(); return null }
  if (lib.error) {
    // A cached snapshot can be truncated or in an older format the current client
    // can't read (e.g. a column it now selects is absent) — Retry re-runs the same
    // failing load, so also offer to drop the cache and re-download a fresh copy.
    const clearAndReload = () => clearCachedSnapshot().then(lib.reload).catch(lib.reload)
    return (
      <div style={center}>
        <div>Couldn’t load the library.</div>
        <div style={{ opacity: 0.7, fontSize: 13 }}>{lib.error}</div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button onClick={lib.reload}>Retry</button>
          <button onClick={clearAndReload}>Clear cache &amp; reload</button>
        </div>
      </div>
    )
  }
  return (
    <>
      <NavShell active={active} onNavigate={navigate} theme={theme} onToggleTheme={onToggleTheme}
                reviewCount={reviewCount} pendingCount={pendingCount}>
        {surface(active, theme, onToggleTheme)}
      </NavShell>
      <Toaster />
    </>
  )
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
