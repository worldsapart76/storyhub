import { NavShell } from '../../components/NavShell'
import { SyncView } from '../../components/SyncView'

/* Sync surface inside the app shell — worker heartbeat, manual triggers, the
   pc_jobs queue, and the activity feed. */
export function SyncSurface() {
  return (
    <div style={{ height: 680 }}>
      <NavShell>
        <SyncView />
      </NavShell>
    </div>
  )
}
