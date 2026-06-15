import { NavShell } from '../../components/NavShell'
import { BrowseView } from '../../components/BrowseView'

/* Full Browse surface inside the app shell. Desktop/Tablet: filter panel docked
   right + sidebar nav. Phone: bottom tabs + "☰ Filters" opens the drawer. */
export function BrowseSurface() {
  return (
    <div style={{ height: 680 }}>
      <NavShell>
        <BrowseView />
      </NavShell>
    </div>
  )
}
