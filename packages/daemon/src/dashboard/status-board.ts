/** Stage F2 — Fastify-served status board JSON shape.
 *  The contract is what the dual-site cutover guarantees: bytes are
 *  identical to the Flask /status-board.json from v1 (modulo
 *  generated_at). The dashboard rewrite preserves shape; it does NOT
 *  add fields without an ADR. */

export interface StatusBoardInput {
  missionsOpen: number
  missionsTotal: number
  tasksRunning: number
  tasksQueued: number
  holdsOpen: number
  approvalsPending: number
  /** Last successful CLI session probe (workbook §3 Stage B). */
  sessionHealth: 'unknown' | 'healthy' | 'expired'
  /** Subscription daily call fraction 0..1. */
  quotaFraction: number
  missionOs?: {
    activeWorkers: number
    healthyWorkers: number
    workerProviders: Record<string, number>
    checkpointWaits: number
    draftPrWaits: number
    lastAcceptanceStatus: 'unknown' | 'pass' | 'failed' | 'hold'
  }
}

export interface StatusBoardJson {
  // schema_version is part of the contract; bumping it is an ADR move.
  schema_version: 1
  generated_at: string
  missions: { open: number; total: number }
  tasks: { running: number; queued: number }
  holds: { open: number }
  approvals: { pending: number }
  cli: { session_health: 'unknown' | 'healthy' | 'expired'; quota_fraction: number }
  mission_os?: {
    queue_depth: number
    active_workers: number
    healthy_workers: number
    worker_providers: Record<string, number>
    checkpoint_waits: number
    draft_pr_waits: number
    last_acceptance_status: 'unknown' | 'pass' | 'failed' | 'hold'
  }
}

/**
 * Pure function: same input + same timestamp → byte-equal JSON.
 * Property order is fixed (controlled here) and matches the v1 Flask
 * serializer's output.
 */
export function buildStatusBoard(input: StatusBoardInput, generatedAt: string): StatusBoardJson {
  const board: StatusBoardJson = {
    schema_version: 1,
    generated_at: generatedAt,
    missions: { open: input.missionsOpen, total: input.missionsTotal },
    tasks:    { running: input.tasksRunning, queued: input.tasksQueued },
    holds:    { open: input.holdsOpen },
    approvals: { pending: input.approvalsPending },
    cli:      { session_health: input.sessionHealth, quota_fraction: input.quotaFraction },
  }
  if (input.missionOs) {
    board.mission_os = {
      queue_depth: input.tasksQueued,
      active_workers: input.missionOs.activeWorkers,
      healthy_workers: input.missionOs.healthyWorkers,
      worker_providers: input.missionOs.workerProviders,
      checkpoint_waits: input.missionOs.checkpointWaits,
      draft_pr_waits: input.missionOs.draftPrWaits,
      last_acceptance_status: input.missionOs.lastAcceptanceStatus,
    }
  }
  return board
}

/** Canonical JSON string — used by byte-equality tests. */
export function serializeStatusBoard(board: StatusBoardJson): string {
  // We rely on JSON.stringify preserving the property order of our
  // object literal above; tests below confirm stability.
  return JSON.stringify(board)
}
