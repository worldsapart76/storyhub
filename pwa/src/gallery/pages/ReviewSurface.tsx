import { NavShell } from '../../components/NavShell'
import { ReviewQueue } from '../../components/ReviewQueue'

/* The Review Queue surface inside the app shell. Each row gates only the two
   primaries (ship + collection); confirm/skip per row, or bulk-confirm the
   already-resolved ones. */
export function ReviewSurface() {
  return (
    <div style={{ height: 680 }}>
      <NavShell>
        <ReviewQueue />
      </NavShell>
    </div>
  )
}
