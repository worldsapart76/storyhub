import { NavShell } from '../../components/NavShell'
import { SavedFilters } from '../../components/SavedFilters'

/* Saved Filters surface inside the app shell — drag-orderable preset list with
   star-to-pin, apply, and the re-validate flag for terms that have since folded
   into a group. */
export function SavedFiltersSurface() {
  return (
    <div style={{ height: 680 }}>
      <NavShell>
        <SavedFilters />
      </NavShell>
    </div>
  )
}
