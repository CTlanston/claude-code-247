/**
 * v5-P3 read-only squad view (WORKBOOK v5 proposal §P3).
 *
 * Everything here is DERIVED from existing tables and events (GR#5):
 * the fleet_workers registry, the fleet.task_claimed claim ledger,
 * cost.headless_call counters and the holds table. No new state.
 *
 * The view is strictly read-only and never exposes key material — public
 * keys stay out of the payload entirely. Write actions remain owner-only
 * and are NOT part of this surface.
 */
import type { AedevDb, FleetWorkerStatus } from '@aedev/core'
import { countHeadlessCallsToday, HOLD_BUDGET_CODE } from '../headless-budget-guard.js'
import { isWorkerAlive } from './claims.js'
import type { FleetClock } from './auth.js'

export const HOLD_EVIDENCE_MISMATCH_CODE = 'HOLD-EVIDENCE-MISMATCH'

/** Per-operator budget identity for fleet claims (v5-P3): one budget
 *  session per operator, so HOLD-BUDGET lands on `fleet:<operatorId>`. */
export function fleetBudgetSessionKey(operatorId: string): string {
  return `fleet:${operatorId}`
}

export interface FleetOverviewWorker {
  workerId: string
  operatorId: string
  status: FleetWorkerStatus
  lastSeenAt: string | null
  claimedTaskIds: string[]
}

export interface FleetOverviewHold {
  code: string
  entityType: string
  entityId: string
  reason: string
  createdAt: string
}

export interface FleetOverviewOperator {
  operatorId: string
  headlessCallsToday: number
  activeHolds: FleetOverviewHold[]
}

export interface FleetOverview {
  workers: FleetOverviewWorker[]
  operators: FleetOverviewOperator[]
}

export function buildFleetOverview(db: AedevDb, clock: FleetClock): FleetOverview {
  const registry = db.listFleetWorkers()
  const now = new Date(clock.now())

  // Claim ledger semantics (see fleet/claims.ts): a pending task is held by
  // a claimer that is still alive; dead claimers hold nothing.
  const heldBy = new Map<string, string[]>()
  for (const task of db.listTasks().filter((t) => t.status === 'pending')) {
    for (const e of db.queryEvents({ type: 'fleet.task_claimed', entityId: task.id })) {
      const workerId = String(e.payload['workerId'] ?? '')
      const claimer = registry.find((w) => w.workerId === workerId)
      if (!claimer || !isWorkerAlive(claimer, clock)) continue
      const list = heldBy.get(workerId) ?? []
      if (!list.includes(task.id)) list.push(task.id)
      heldBy.set(workerId, list)
    }
  }

  const workers: FleetOverviewWorker[] = registry.map((w) => ({
    workerId: w.workerId,
    operatorId: w.operatorId,
    status: w.status,
    lastSeenAt: w.lastSeenAt ?? null,
    claimedTaskIds: heldBy.get(w.workerId) ?? [],
  }))

  // HOLD attribution: HOLD-BUDGET lives on `fleet:<operatorId>`;
  // HOLD-EVIDENCE-MISMATCH lives on the task and links back to the operator
  // through the fleet.worker_frozen event recorded for that task.
  const activeHolds = db.listActiveHolds()
  const frozenEvents = db.queryEvents({ type: 'fleet.worker_frozen' })
  const operators: FleetOverviewOperator[] = [...new Set(registry.map((w) => w.operatorId))]
    .sort()
    .map((operatorId) => ({
      operatorId,
      headlessCallsToday: countHeadlessCallsToday(db, now, operatorId),
      activeHolds: activeHolds
        .filter((h) => {
          if (h.code === HOLD_BUDGET_CODE) return h.entityId === fleetBudgetSessionKey(operatorId)
          if (h.code === HOLD_EVIDENCE_MISMATCH_CODE) {
            return frozenEvents.some((e) => e.payload['taskId'] === h.entityId
              && registry.some((w) => w.workerId === e.entityId && w.operatorId === operatorId))
          }
          return false
        })
        .map((h) => ({ code: h.code, entityType: h.entityType, entityId: h.entityId, reason: h.reason, createdAt: h.createdAt })),
    }))

  return { workers, operators }
}
