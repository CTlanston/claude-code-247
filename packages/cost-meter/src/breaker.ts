/** GROUND RULE 12 — cost-cap circuit breaker.
 *
 * Watches the CostRoller snapshot. When cost_per_pr_usd over the
 * rolling window crosses the hard_cap (NEXT_PLAN_WORKBOOK §0
 * `cost_per_autonomous_pr_usd_7d.hard_cap`, default 15.0 USD), trips
 * the breaker. Daemon's RoadmapAgent loop checks `tripped()` before
 * spawning the next mission.
 *
 * The breaker emits one (and only one) `hold.policy.created` event
 * with reason `cost_cap_breached` per trip. A reset() call is
 * required (operator action through InterruptService.resolve) to
 * re-arm; without it the breaker stays tripped even if the rolling
 * window drops back below threshold (anti-thrash).
 */
import type { EventLog } from '@aedev/event-log'
import type { CostRoller } from './roller.js'

export interface CostBreakerOpts {
  log: EventLog
  taskId: string
  roller: CostRoller
  /** Soft warning at this fraction of hardCap (default 0.8 → 12 USD when cap=15). */
  warnFraction?: number
  /** Hard USD/PR cap (default 15.0 per NEXT_PLAN_WORKBOOK §0). */
  hardCapUsd?: number
  actor?: string
  now?: () => Date
}

export interface BreakerVerdict {
  tripped: boolean
  warning: boolean
  observedCostPerPr: number
  hardCapUsd: number
  warnAtUsd: number
}

export class CostBreaker {
  private readonly log: EventLog
  private readonly taskId: string
  private readonly roller: CostRoller
  private readonly hardCap: number
  private readonly warnAt: number
  private readonly actor: string
  private readonly now: () => Date
  private trippedAt: string | null = null
  private warnedAt: string | null = null

  constructor(opts: CostBreakerOpts) {
    this.log = opts.log
    this.taskId = opts.taskId
    this.roller = opts.roller
    this.hardCap = opts.hardCapUsd ?? 15.0
    const wf = opts.warnFraction ?? 0.8
    this.warnAt = this.hardCap * wf
    this.actor = opts.actor ?? 'daemon.cost-breaker'
    this.now = opts.now ?? (() => new Date())
  }

  /** Inspect current state without side effects. */
  inspect(): BreakerVerdict {
    const observed = this.roller.avgPerBucket()
    return {
      tripped: observed >= this.hardCap,
      warning: observed >= this.warnAt && observed < this.hardCap,
      observedCostPerPr: observed,
      hardCapUsd: this.hardCap,
      warnAtUsd: this.warnAt,
    }
  }

  /** Tick the breaker — emit events on first cross of warn / hard thresholds.
   *  Returns the verdict for the caller (typically RoadmapAgent dispatch). */
  async tick(): Promise<BreakerVerdict> {
    const v = this.inspect()
    const ts = this.now().toISOString()

    if (v.warning && !this.warnedAt) {
      this.warnedAt = ts
      await this.log.append({
        task_id: this.taskId,
        ts,
        actor: this.actor,
        kind: 'cost.budget.warning',
        payload: {
          observedCostPerPr: v.observedCostPerPr,
          warnAtUsd: v.warnAtUsd,
          hardCapUsd: v.hardCapUsd,
        },
        idempotency_source: `${this.taskId}|cost.budget.warning|${this.warnedAt}`,
      })
    }

    if (v.tripped && !this.trippedAt) {
      this.trippedAt = ts
      await this.log.append({
        task_id: this.taskId,
        ts,
        actor: this.actor,
        kind: 'hold.policy.created',
        payload: {
          reason: 'cost_cap_breached',
          observedCostPerPr: v.observedCostPerPr,
          hardCapUsd: v.hardCapUsd,
          autoPaused: 'RoadmapAgent dispatch loop',
        },
        idempotency_source: `${this.taskId}|hold.policy.created|cost_cap_breached|${this.trippedAt}`,
      })
    }

    return v
  }

  /** True while the breaker is tripped — RoadmapAgent should refuse to
   *  spawn new missions while this is true. */
  isTripped(): boolean {
    return this.trippedAt !== null
  }

  /** Operator-only re-arm. Production wires this behind a
   *  HOLD-resolved event subscription. */
  reset(): void {
    this.trippedAt = null
    this.warnedAt = null
  }
}
