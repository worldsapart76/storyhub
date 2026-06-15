import { useMemo, useState } from 'react'
import './SyncView.css'
import {
  SYNC_TRIGGERS, PC_JOBS, ACTIVITY_EVENTS, SNAPSHOT_VERSION, WORKER_HEARTBEAT_AGE,
  type WorkerStatus, type SyncTrigger, type PcJob, type ActivityEvent, type JobStatus, type ActivityKind,
} from '../mock/data'

/* Sync view (redesign §12.4–12.5). Worker heartbeat + pc_jobs queue + manual
   triggers + activity feed. Worker triggers (Sync X4, Backup pull) gate on the
   heartbeat; server triggers (Refresh snapshot, Re-upload to R2) are Railway-side
   and always available. No FanFicFare update check (removed — hard rule). */

const STATUS_LABEL: Record<WorkerStatus, string> = { online: 'Online', stale: 'Stale', offline: 'Offline' }
const NEXT_STATUS: Record<WorkerStatus, WorkerStatus> = { online: 'stale', stale: 'offline', offline: 'online' }
const JOB_DOT: Record<JobStatus, string> = { pending: '○', running: '◐', done: '●', failed: '✕' }
const ACT_ICON: Record<ActivityKind, string> = {
  capture: '📥', status: '✎', snapshot: '📦', transfer: '📲', backup: '💾', error: '⚠',
}

export function SyncView() {
  // Heartbeat status is derived in the real app; the pill cycles here so the
  // three indicator states (and the worker-trigger gating) are reviewable.
  const [worker, setWorker] = useState<WorkerStatus>('online')
  const [triggers, setTriggers] = useState<SyncTrigger[]>(SYNC_TRIGGERS)
  const [jobs, setJobs] = useState<PcJob[]>(PC_JOBS)
  const [activity, setActivity] = useState<ActivityEvent[]>(ACTIVITY_EVENTS)

  const counts = useMemo(() => ({
    pending: jobs.filter((j) => j.status === 'pending').length,
    running: jobs.filter((j) => j.status === 'running').length,
    failed: jobs.filter((j) => j.status === 'failed').length,
  }), [jobs])

  const logEvent = (kind: ActivityKind, message: string) =>
    setActivity((prev) => [{ id: Date.now(), kind, message, time: 'just now' }, ...prev])

  const run = (t: SyncTrigger) => {
    setTriggers((prev) => prev.map((x) => (x.id === t.id ? { ...x, lastStatus: 'running', lastRun: 'just now' } : x)))
    if (t.scope === 'worker' && t.jobType) {
      setJobs((prev) => [{ id: 'j-' + Date.now(), type: t.jobType!, status: 'running', detail: `${t.label} started`, time: 'now' }, ...prev])
    }
    const kind: ActivityKind = t.id === 'snapshot' ? 'snapshot' : t.id === 'r2' ? 'snapshot' : t.jobType === 'backup_pull' ? 'backup' : 'transfer'
    logEvent(kind, `${t.label} started`)
  }

  const retry = (job: PcJob) => {
    setJobs((prev) => prev.map((j) => (j.id === job.id ? { ...j, status: 'running', detail: 'Retrying…', time: 'now' } : j)))
    logEvent(job.type === 'backup_pull' ? 'backup' : 'transfer', `Retrying ${job.type === 'backup_pull' ? 'backup pull' : 'X4 transfer'}`)
  }

  const workerTriggers = triggers.filter((t) => t.scope === 'worker')
  const serverTriggers = triggers.filter((t) => t.scope === 'server')

  return (
    <div className="sv">
      <header className="sv__head">
        <h1 className="sv__title">Sync</h1>
        <button
          className={'sv__status sv__status--' + worker}
          onClick={() => setWorker((w) => NEXT_STATUS[w])}
          title="Worker heartbeat (click to preview states)"
        >
          <span className="sv__dot" aria-hidden />
          Worker {STATUS_LABEL[worker]}
          <span className="sv__heartbeat">· {worker === 'offline' ? 'no heartbeat' : WORKER_HEARTBEAT_AGE}</span>
        </button>
      </header>

      <div className="sv__cols">
        <div className="sv__col">
          {/* Worker-side triggers — gated by heartbeat */}
          <section className="sv__section">
            <div className="sv__sechead">
              <span className="sv__seclabel">Worker</span>
              {worker !== 'online' && <span className="sv__gatenote">offline — triggers unavailable</span>}
            </div>
            <div className="sv__triggers">
              {workerTriggers.map((t) => (
                <TriggerCard key={t.id} trigger={t} disabled={worker !== 'online'} onRun={() => run(t)} />
              ))}
            </div>
          </section>

          {/* Server-side triggers — always available */}
          <section className="sv__section">
            <div className="sv__sechead">
              <span className="sv__seclabel">Library</span>
              <span className="sv__snapver">snapshot v{SNAPSHOT_VERSION}</span>
            </div>
            <div className="sv__triggers">
              {serverTriggers.map((t) => (
                <TriggerCard key={t.id} trigger={t} onRun={() => run(t)} />
              ))}
            </div>
          </section>

          {/* pc_jobs queue summary */}
          <section className="sv__section">
            <div className="sv__sechead"><span className="sv__seclabel">Queue</span></div>
            <div className="sv__queuecounts">
              <span className="sv__count">{counts.pending} pending</span>
              <span className="sv__count sv__count--running">{counts.running} running</span>
              <span className={'sv__count' + (counts.failed ? ' sv__count--failed' : '')}>{counts.failed} failed</span>
            </div>
            <ul className="sv__jobs">
              {jobs.map((j) => (
                <li key={j.id} className="sv__job">
                  <span className={'sv__jobdot sv__jobdot--' + j.status} aria-hidden>{JOB_DOT[j.status]}</span>
                  <span className="sv__jobtype">{j.type === 'x4_transfer' ? 'X4 transfer' : 'Backup pull'}</span>
                  <span className="sv__jobdetail">{j.detail}</span>
                  <span className="sv__jobtime">{j.time}</span>
                  {j.status === 'failed' && <button className="sv__retry" onClick={() => retry(j)}>Retry</button>}
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* Activity feed */}
        <section className="sv__section sv__activity">
          <div className="sv__sechead"><span className="sv__seclabel">Activity</span></div>
          <ul className="sv__feed">
            {activity.map((e) => (
              <li key={e.id} className={'sv__event' + (e.kind === 'error' ? ' is-error' : '')}>
                <span className="sv__eventicon" aria-hidden>{ACT_ICON[e.kind]}</span>
                <span className="sv__eventmsg">{e.message}</span>
                <span className="sv__eventtime">{e.time}</span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  )
}

function TriggerCard({ trigger, disabled, onRun }: { trigger: SyncTrigger; disabled?: boolean; onRun: () => void }) {
  const running = trigger.lastStatus === 'running'
  return (
    <div className={'sv__trigger' + (disabled ? ' is-disabled' : '')}>
      <div className="sv__triggertop">
        <span className="sv__triggerlabel">{trigger.label}</span>
        <button className="sv__runbtn" disabled={disabled || running} onClick={onRun}>
          {running ? 'Running…' : 'Run'}
        </button>
      </div>
      <div className="sv__triggermeta">
        {trigger.lastStatus && <span className={'sv__triggerstatus sv__triggerstatus--' + trigger.lastStatus}>{trigger.lastStatus}</span>}
        {trigger.lastRun && <span className="sv__triggerlast">{trigger.lastRun}</span>}
      </div>
    </div>
  )
}
