/**
 * v5-P2 claim protocol + evidence trust anchor (ADR-0022/0023).
 *
 * DESIGN CHOICE — event-based claim ledger, tasks table untouched:
 * a claim is the event `fleet.task_claimed` (payload: workerId), not a
 * column on `tasks`. A pending task is "held" while ANY claiming worker is
 * still alive (active + heartbeat within HEARTBEAT_TIMEOUT_MS); when the
 * claimer goes silent the task becomes claimable again with zero mutation —
 * the reclaim is just a newer claim event. This is the simplest honest
 * design: GR#5 (event-first, rebuildable) holds across machines, no schema
 * coupling with the local mission-runner path, and kill -9 recovery needs
 * no janitor job.
 */
import type { AedevDb, FleetWorker, Task } from '@aedev/core'
import { HEARTBEAT_TIMEOUT_MS, type FleetClock } from './auth.js'

export function isWorkerAlive(worker: FleetWorker, clock: FleetClock): boolean {
  if (worker.status !== 'active') return false
  if (!worker.lastSeenAt) return false
  return clock.now() - Date.parse(worker.lastSeenAt) <= HEARTBEAT_TIMEOUT_MS
}

/** Oldest pending task not currently held by a living claimer. */
export function findClaimableTask(db: AedevDb, clock: FleetClock): Task | undefined {
  const pending = db.listTasks()
    .filter((t) => t.status === 'pending')
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
  for (const task of pending) {
    const claims = db.queryEvents({ type: 'fleet.task_claimed', entityId: task.id })
    const held = claims.some((e) => {
      const claimer = db.getFleetWorker(String(e.payload['workerId'] ?? ''))
      return claimer ? isWorkerAlive(claimer, clock) : false
    })
    if (!held) return task
  }
  return undefined
}

/**
 * Assign the oldest claimable pending task to the worker. A successful claim
 * also counts as a heartbeat. Idempotency across retries of the SAME request
 * is handled one layer up via the (workerId, nonce) cached response.
 */
export function claimTask(db: AedevDb, worker: FleetWorker, nonce: string, clock: FleetClock): { task: Task | null } {
  db.touchFleetWorker(worker.workerId, new Date(clock.now()).toISOString())
  const refreshed = db.getFleetWorker(worker.workerId) ?? worker
  const task = findClaimableTask(db, clock)
  if (!task) return { task: null }
  db.insertEvent('fleet.task_claimed', 'task', task.id, { workerId: refreshed.workerId, nonce }, refreshed.operatorId)
  return { task }
}

export interface CiResult { gates: Record<string, boolean> }

export interface EvidenceMismatchVerdict {
  mismatch: boolean
  workerId?: string
  mismatchedGates: string[]
}

/**
 * Trust anchor (ADR-0022): the worker self-report is reference only; the
 * GitHub CI-on-PR result is the only truth. A gate the worker reported as
 * PASSING that CI reports as FAILING is forged evidence — open
 * HOLD-EVIDENCE-MISMATCH on the task, freeze the worker, and append
 * `fleet.worker_frozen`. Frozen workers' claims/events are rejected (403).
 */
export function detectEvidenceMismatch(db: AedevDb, taskId: string, ciResult: CiResult): EvidenceMismatchVerdict {
  const report = db.queryEvents({ type: 'fleet.evidence_reported', entityId: taskId, limit: 1 })[0]
  if (!report) return { mismatch: false, mismatchedGates: [] }
  const selfGates = (report.payload['selfReport'] as { gates?: Record<string, boolean> } | undefined)?.gates ?? {}
  const mismatchedGates = Object.keys(ciResult.gates)
    .filter((gate) => selfGates[gate] === true && ciResult.gates[gate] === false)
  if (mismatchedGates.length === 0) return { mismatch: false, mismatchedGates: [] }

  const workerId = String(report.payload['workerId'] ?? '')
  db.insertHold({
    entityType: 'task',
    entityId: taskId,
    code: 'HOLD-EVIDENCE-MISMATCH',
    reason: `Worker ${workerId || 'unknown'} self-reported gates [${mismatchedGates.join(', ')}] as passing but CI reports them failing.`,
    nextAction: 'Owner compares CI logs vs the self-report, then explicitly unfreezes or retires the worker.',
  })
  db.insertEvent('fleet.worker_frozen', 'fleet_worker', workerId || 'unknown', { taskId, mismatchedGates }, 'owner')
  if (workerId) db.setFleetWorkerStatus(workerId, 'frozen')
  return { mismatch: true, ...(workerId ? { workerId } : {}), mismatchedGates }
}
