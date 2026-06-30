/* pc_jobs (worker thin-agent job queue, §12.4) + worker liveness. The dashboard
   enqueues a job and polls its status/log; the Windows worker claims + runs it. */

import { authHeaders, getHub } from './config'

export type PcJobType = 'x4_transfer' | 'backup_pull'
export type PcJobStatus = 'pending' | 'running' | 'done' | 'failed'

export type PcJob = {
  id: string
  jobType: PcJobType
  status: PcJobStatus
  log: string | null
  workerId: string | null
  createdAt: string
  startedAt: string | null
  finishedAt: string | null
}

export type WorkerStatus = {
  workerId: string
  lastSeenAt: string
  alive: boolean
}

export const JOB_LABEL: Record<PcJobType, string> = {
  x4_transfer: 'X4 / XTEINK transfer',
  backup_pull: 'Backup pull',
}

type RawJob = {
  id: string; job_type: PcJobType; status: PcJobStatus; log: string | null
  worker_id: string | null; created_at: string; started_at: string | null
  finished_at: string | null
}

const mapJob = (j: RawJob): PcJob => ({
  id: j.id, jobType: j.job_type, status: j.status, log: j.log,
  workerId: j.worker_id, createdAt: j.created_at, startedAt: j.started_at,
  finishedAt: j.finished_at,
})

export async function fetchJobs(limit = 20): Promise<PcJob[]> {
  const res = await fetch(`${getHub()}/api/pc-jobs?limit=${limit}`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`jobs → ${res.status}`)
  return ((await res.json()) as RawJob[]).map(mapJob)
}

export async function createJob(
  jobType: PcJobType, params: Record<string, unknown> = {},
): Promise<PcJob> {
  const res = await fetch(`${getHub()}/api/pc-jobs`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': 'application/json' },
    body: JSON.stringify({ job_type: jobType, params }),
  })
  if (!res.ok) throw new Error(`enqueue → ${res.status} ${await res.text().catch(() => '')}`.trim())
  return mapJob(await res.json())
}

export async function fetchWorkerStatus(): Promise<WorkerStatus[]> {
  const res = await fetch(`${getHub()}/api/worker/status`, { headers: authHeaders() })
  if (!res.ok) throw new Error(`worker status → ${res.status}`)
  return ((await res.json()) as { worker_id: string; last_seen_at: string; alive: boolean }[])
    .map((w) => ({ workerId: w.worker_id, lastSeenAt: w.last_seen_at, alive: w.alive }))
}
