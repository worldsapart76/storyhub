import { NavShell } from '../../components/NavShell'
import { ReadingLists } from '../../components/ReadingLists'

/* Reading Lists surface inside the app shell — index grid → list detail with
   drag-reorder, auto-pin, and member bulk actions. */
export function ReadingListsSurface() {
  return (
    <div style={{ height: 680 }}>
      <NavShell>
        <ReadingLists />
      </NavShell>
    </div>
  )
}
