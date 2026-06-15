import { NavShell } from '../../components/NavShell'

/* The app shell renders full-bleed inside the device frame so its responsive
   flip (sidebar ↔ bottom tabs) is visible: Desktop/Tablet = sidebar, Phone =
   bottom tabs. Click nav items to see active state + the Review Queue badge. */
export function KitShell() {
  return (
    <div style={{ height: 640 }}>
      <NavShell />
    </div>
  )
}
