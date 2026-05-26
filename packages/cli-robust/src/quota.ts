import type { EventLog } from '@aedev/event-log'
import type { QuotaPolicy, QuotaSnapshot } from './types.js'

export interface QuotaTrackerOpts {
  log: EventLog
  taskId: string
  policy: QuotaPolicy
  actor?: string
  now?: () => Date
}

const MS_PER_DAY = 24 * 60 * 60 * 1000

function utcDayStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
}

/**
 * QuotaTracker — Stage B.1 prototype subscription budget.
 *
 * Records each subscription call against a per-day cap. Emits:
 *  - `cli.quota.threshold` when usage first crosses warnAtFraction
 *  - `hold.created` with reason `quota_exhausted` when the cap is hit
 *
 * Idempotency: events are keyed by `(taskId, dayBucket, kind)` so re-running
 * a probe day after a daemon restart doesn't re-fire the warn/hold.
 *
 * Stage M1 turns this into a quota oracle (±5% accuracy from the real CLI
 * billing surface). Stage B only needs it to fire HOLD wires correctly.
 */
export class QuotaTracker {
  private readonly log: EventLog
  private readonly taskId: string
  private readonly policy: QuotaPolicy
  private readonly actor: string
  private readonly now: () => Date
  private callsToday = 0
  private warned = false
  private exhausted = false
  private bucketStart: number = 0

  constructor(opts: QuotaTrackerOpts) {
    this.log = opts.log
    this.taskId = opts.taskId
    this.policy = opts.policy
    this.actor = opts.actor ?? 'worker.quota-tracker'
    this.now = opts.now ?? (() => new Date())
    this.bucketStart = utcDayStart(this.now()).getTime()
  }

  /** Reset bucket state if we have crossed into a new UTC day. */
  private rollBucketIfNeeded(): void {
    const interval = this.policy.resetIntervalMs ?? MS_PER_DAY
    const nowMs = this.now().getTime()
    if (nowMs - this.bucketStart >= interval) {
      this.callsToday = 0
      this.warned = false
      this.exhausted = false
      this.bucketStart = interval === MS_PER_DAY ? utcDayStart(this.now()).getTime() : nowMs
    }
  }

  snapshot(): QuotaSnapshot {
    this.rollBucketIfNeeded()
    const interval = this.policy.resetIntervalMs ?? MS_PER_DAY
    return {
      callsToday: this.callsToday,
      dailyLimit: this.policy.dailyLimit,
      fraction: this.callsToday / this.policy.dailyLimit,
      exhausted: this.exhausted,
      warned: this.warned,
      resetsAt: new Date(this.bucketStart + interval).toISOString(),
    }
  }

  /** Record one CLI call. Returns the post-record snapshot. */
  async record(): Promise<QuotaSnapshot> {
    this.rollBucketIfNeeded()
    this.callsToday += 1
    const fraction = this.callsToday / this.policy.dailyLimit
    const ts = this.now().toISOString()
    const dayKey = new Date(this.bucketStart).toISOString().slice(0, 10)

    if (!this.warned && fraction >= this.policy.warnAtFraction) {
      this.warned = true
      await this.log.append({
        task_id: this.taskId,
        ts,
        actor: this.actor,
        kind: 'cli.quota.threshold',
        payload: {
          callsToday: this.callsToday,
          dailyLimit: this.policy.dailyLimit,
          fraction,
        },
        idempotency_source: `${this.taskId}|cli.quota.threshold|${dayKey}`,
      })
    }

    if (!this.exhausted && this.callsToday >= this.policy.dailyLimit) {
      this.exhausted = true
      await this.log.append({
        task_id: this.taskId,
        ts,
        actor: this.actor,
        kind: 'hold.policy.created',
        payload: {
          reason: 'quota_exhausted',
          callsToday: this.callsToday,
          dailyLimit: this.policy.dailyLimit,
        },
        idempotency_source: `${this.taskId}|hold.policy.created|quota_exhausted|${dayKey}`,
      })
    }

    return this.snapshot()
  }
}
