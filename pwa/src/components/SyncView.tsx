import { useEffect, useState } from 'react'
import './SyncView.css'
import { fetchPipeline, dismissQueueItem, type PipelineItem, type PipelineState } from '../data/pipeline'
import {
  createJob, fetchJobs, fetchWorkerStatus, JOB_LABEL,
  type PcJob, type PcJobType, type WorkerStatus,
} from '../data/jobs'
import { rebuildSnapshot } from '../data/snapshot'
import { useLibrary } from '../data/library'
import { toast } from '../data/toast'
import { Button } from './Button'

/* Sync view (redesign §12.4–12.5). Drives the Windows worker's PC-bound jobs
   (X4/XTEINK transfer, backup pull) via the pc_jobs queue, shows worker liveness
   (heartbeat) and live job status/log. Also: server-side snapshot rebuild + the
   import-pipeline inspector (legacy queue_items). */

const STATE_LABEL: Record<PipelineState, string> = {
  pending: 'Pending', normalized: 'Normalizing', auto_committed: 'Auto-commit',
  needs_review: 'Needs review', committed: 'Committed', failed: 'Failed',
}

const JOB_STATUS_LABEL: Record<PcJob['status'], string> = {
  pending: 'Queued', running: 'Running', done: 'Done', failed: 'Failed',
}

const TRIGGERS: { type: PcJobType; blurb: string }[] = [
  { type: 'x4_transfer', blurb: 'Sync favorites + unread (and catalog) to the SD card' },
  { type: 'backup_pull', blurb: 'Mirror the snapshot + every epub to your backup folder' },
]

export function SyncView() {
  const lib = useLibrary()
  const [items, setItems] = useState<PipelineItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const [jobs, setJobs] = useState<PcJob[] | null>(null)
  const [workers, setWorkers] = useState<WorkerStatus[] | null>(null)
  const [enqueuing, setEnqueuing] = useState(false)

  function loadPipeline() {
    setItems(null)
    setError(null)
    fetchPipeline().then(setItems).catch((e) => setError(e instanceof Error ? e.message : String(e)))
  }
  useEffect(loadPipeline, [])

  // Live worker + job polling while the view is open (4s; worker beats every 30s).
  useEffect(() => {
    let active = true
    const tick = async () => {
      try {
        const [j, w] = await Promise.all([fetchJobs(), fetchWorkerStatus()])
        if (active) { setJobs(j); setWorkers(w) }
      } catch { /* transient; next tick retries */ }
    }
    tick()
    const id = setInterval(tick, 4000)
    return () => { active = false; clearInterval(id) }
  }, [])

  const workerAlive = !!workers?.some((w) => w.alive)
  const activeJob = jobs?.find((j) => j.status === 'pending' || j.status === 'running') || null

  async function enqueue(type: PcJobType) {
    if (enqueuing) return
    setEnqueuing(true)
    try {
      await createJob(type)
      toast(`Queued: ${JOB_LABEL[type]}`)
      fetchJobs().then(setJobs).catch(() => {})
    } catch (e) {
      toast(`Couldn’t queue: ${e instanceof Error ? e.message : e}`, 'err')
    } finally {
      setEnqueuing(false)
    }
  }

  async function dismiss(it: PipelineItem) {
    if (!window.confirm(`Dismiss this pipeline item?\n\n“${it.title}”\n\nThis removes the queue entry only — a work already in your library is unaffected.`)) return
    try {
      await dismissQueueItem(it.id)
      setItems((prev) => (prev ? prev.filter((x) => x.id !== it.id) : prev))
    } catch (e) {
      toast(`Dismiss failed: ${e instanceof Error ? e.message : e}`, 'err')
    }
  }

  function refreshSnapshot() {
    setBusy(true)
    rebuildSnapshot()
      .then(() => lib.reload())
      .catch((e) => toast(`Snapshot rebuild failed: ${e instanceof Error ? e.message : e}`, 'err'))
      .finally(() => setBusy(false))
  }

  return (
    <div className="sv">
      <header className="sv__head">
        <h1 className="sv__title">Sync</h1>
        {workers === null ? (
          <span className="sv__status"><span className="sv__dot" aria-hidden />Checking worker…</span>
        ) : workerAlive ? (
          <span className="sv__status sv__status--online" title={workerOnlineTitle(workers)}>
            <span className="sv__dot" aria-hidden />Worker online
          </span>
        ) : (
          <span className="sv__status sv__status--offline" title={workerOfflineTitle(workers)}>
            <span className="sv__dot" aria-hidden />Worker offline
          </span>
        )}
      </header>

      <div className="sv__cols">
        <div className="sv__col">
          {/* Worker jobs — pc_jobs */}
          <section className="sv__section">
            <div className="sv__sechead"><span className="sv__seclabel">Worker</span></div>
            {!workerAlive && workers !== null && (
              <div className="sv__note">Worker offline — a job you start will run when it next connects.</div>
            )}
            <div className="sv__triggers">
              {TRIGGERS.map(({ type, blurb }) => (
                <div className="sv__trigger" key={type}>
                  <div className="sv__triggertop">
                    <span className="sv__triggerlabel">{JOB_LABEL[type]}</span>
                    <Button
                      variant="primary" size="sm"
                      disabled={enqueuing || !!activeJob}
                      onClick={() => enqueue(type)}
                    >
                      {activeJob ? 'Busy…' : 'Run'}
                    </Button>
                  </div>
                  <div className="sv__triggermeta"><span className="sv__triggerlast">{blurb}</span></div>
                </div>
              ))}
            </div>
          </section>

          {/* Server-side snapshot rebuild */}
          <section className="sv__section">
            <div className="sv__sechead"><span className="sv__seclabel">Library</span></div>
            <div className="sv__triggers">
              <div className="sv__trigger">
                <div className="sv__triggertop">
                  <span className="sv__triggerlabel">Refresh snapshot</span>
                  <Button variant="outline" size="sm" disabled={busy} onClick={refreshSnapshot}>
                    {busy ? 'Rebuilding…' : 'Run'}
                  </Button>
                </div>
                <div className="sv__triggermeta">
                  <span className="sv__triggerlast">Re-project Postgres → snapshot and reload</span>
                </div>
              </div>
            </div>
          </section>
        </div>

        {/* Job history + live log */}
        <section className="sv__section sv__activity">
          <div className="sv__sechead"><span className="sv__seclabel">Jobs</span></div>
          {jobs === null ? (
            <div className="sv__placeholder">Loading…</div>
          ) : jobs.length === 0 ? (
            <div className="sv__placeholder">No jobs yet. Start an X4 transfer or backup above.</div>
          ) : (
            <ul className="sv__jobs">
              {jobs.map((j) => (
                <li key={j.id} className="sv__job">
                  <div className="sv__jobtop">
                    <span className="sv__jobtype">{JOB_LABEL[j.jobType] ?? j.jobType}</span>
                    <span className={'sv__jobstate sv__jobstate--' + j.status}>
                      {j.status === 'running' && <span className="sv__spin" aria-hidden />}
                      {JOB_STATUS_LABEL[j.status]}
                    </span>
                    <span className="sv__jobtime">{new Date(j.createdAt).toLocaleString()}</span>
                  </div>
                  {j.log && <pre className="sv__joblog">{j.log}</pre>}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {/* Import pipeline — legacy queue_items inspector */}
      <section className="sv__section">
        <div className="sv__sechead">
          <span className="sv__seclabel">Import pipeline</span>
          <button className="sv__refresh" onClick={loadPipeline} disabled={items === null && !error}>↻</button>
        </div>
        {error ? (
          <div className="sv__placeholder sv__placeholder--err">Couldn’t load the pipeline: {error}</div>
        ) : items === null ? (
          <div className="sv__placeholder">Loading…</div>
        ) : items.length === 0 ? (
          <div className="sv__placeholder">Pipeline clear — nothing pending, stuck, or failed.</div>
        ) : (
          <ul className="sv__pipe">
            {items.map((it) => (
              <li key={it.id} className="sv__pipeitem">
                <div className="sv__pipemain">
                  <a className="sv__pipetitle" href={`https://archiveofourown.org/works/${it.workId}`} target="_blank" rel="noreferrer">
                    {it.title}
                  </a>
                  <div className="sv__pipemeta">
                    <span className={'sv__pipestate sv__pipestate--' + it.state}>{STATE_LABEL[it.state]}</span>
                    {!it.epubStaged && <span className="sv__pipeepub">no epub</span>}
                    <span className="sv__pipetime">{new Date(it.createdAt).toLocaleString()}</span>
                  </div>
                  {it.error && <div className="sv__pipeerr">{it.error}</div>}
                </div>
                <button className="sv__pipedismiss" onClick={() => dismiss(it)} title="Dismiss this item">Dismiss</button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function fmtSeen(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (secs < 90) return 'just now'
  if (secs < 3600) return `${Math.round(secs / 60)}m ago`
  if (secs < 86400) return `${Math.round(secs / 3600)}h ago`
  return new Date(iso).toLocaleString()
}

function workerOnlineTitle(workers: WorkerStatus[]): string {
  const alive = workers.filter((w) => w.alive)
  return alive.map((w) => `${w.workerId} · seen ${fmtSeen(w.lastSeenAt)}`).join('\n')
}

function workerOfflineTitle(workers: WorkerStatus[]): string {
  if (!workers.length) return 'No worker has ever connected'
  const latest = [...workers].sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))[0]
  return `Last seen: ${latest.workerId} · ${fmtSeen(latest.lastSeenAt)}`
}
