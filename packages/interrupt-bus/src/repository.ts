import type { Event, EventLog, Reducer } from '@aedev/event-log'
import { policyFor, type HoldReason } from './policy.js'

export type HoldStatus = 'open' | 'resolved' | 'escalated' | 'dropped'

export interface HoldRecord {
  id: string                // event id of the hold.policy.created event
  taskId: string
  reason: HoldReason
  openedAt: string
  status: HoldStatus
  retries: number
  lastUpdateAt: string
}

/** A reducer that folds hold.policy.* events into the current set of records. */
export const holdReducer: Reducer<Map<string, HoldRecord>> = (state, e) => {
  if (e.kind === 'hold.policy.created') {
    const reason = (e.payload as { reason?: HoldReason }).reason
    if (!reason) return state
    const next = new Map(state)
    next.set(e.id, {
      id: e.id,
      taskId: e.task_id,
      reason,
      openedAt: e.ts,
      status: 'open',
      retries: 0,
      lastUpdateAt: e.ts,
    })
    return next
  }
  // Resolution / escalation / drop / retry events reference the original
  // hold's id via causation_id. We look that up to mutate the record.
  if (
    e.kind === 'hold.policy.resolved' ||
    e.kind === 'hold.policy.escalated' ||
    e.kind === 'hold.policy.dropped' ||
    e.kind === 'hold.policy.retried'
  ) {
    const target = e.causation_id
    if (!target) return state
    const cur = state.get(target)
    if (!cur) return state
    const next = new Map(state)
    const status: HoldStatus =
      e.kind === 'hold.policy.resolved'
        ? 'resolved'
        : e.kind === 'hold.policy.escalated'
          ? 'escalated'
          : e.kind === 'hold.policy.dropped'
            ? 'dropped'
            : cur.status
    next.set(target, {
      ...cur,
      status,
      retries: e.kind === 'hold.policy.retried' ? cur.retries + 1 : cur.retries,
      lastUpdateAt: e.ts,
    })
    return next
  }
  return state
}

export class HoldRepository {
  private readonly log: EventLog
  constructor(log: EventLog) {
    this.log = log
  }

  /** Snapshot of all known holds across all tasks. */
  async snapshot(): Promise<HoldRecord[]> {
    let state = new Map<string, HoldRecord>()
    const anyLog = this.log as unknown as { readAll?: () => AsyncIterable<Event> }
    if (anyLog.readAll) {
      for await (const e of anyLog.readAll()) {
        state = holdReducer(state, e)
      }
    }
    return [...state.values()]
  }

  async snapshotForTask(taskId: string): Promise<HoldRecord[]> {
    const state = await this.log.reduce<Map<string, HoldRecord>>(
      taskId,
      new Map<string, HoldRecord>(),
      holdReducer,
    )
    return [...state.values()]
  }

  /** Convenience: open holds only. */
  async openHolds(): Promise<HoldRecord[]> {
    const all = await this.snapshot()
    return all.filter((h) => h.status === 'open')
  }
}

export { policyFor, HoldReason }
