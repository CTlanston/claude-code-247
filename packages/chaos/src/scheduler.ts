import type { ChaosInjector } from './injector.js'

export interface ChaosScheduleOpts {
  injector: ChaosInjector
  /** Window in which chaos may fire — defaults to Sunday 03:00-04:00 UTC per workbook §3 Stage I. */
  windowStartHourUtc?: number
  windowEndHourUtc?: number
  /** Day of the week (0 = Sunday). */
  dayOfWeek?: number
  now?: () => Date
}

/**
 * ChaosScheduler — Stage I drill scheduler.
 *
 * Stage I says: "周日 03:00–04:00 UTC chaos-window".
 * tick() is called by an external clock (e.g., a setInterval) and runs at
 * most one full-suite injection per visit through the window.
 */
export class ChaosScheduler {
  private readonly injector: ChaosInjector
  private readonly winStart: number
  private readonly winEnd: number
  private readonly day: number
  private readonly now: () => Date
  private lastFiredAtMs = 0

  constructor(opts: ChaosScheduleOpts) {
    this.injector = opts.injector
    this.winStart = opts.windowStartHourUtc ?? 3
    this.winEnd = opts.windowEndHourUtc ?? 4
    this.day = opts.dayOfWeek ?? 0
    this.now = opts.now ?? (() => new Date())
  }

  inWindow(d: Date = this.now()): boolean {
    return d.getUTCDay() === this.day && d.getUTCHours() >= this.winStart && d.getUTCHours() < this.winEnd
  }

  /** Returns true if this tick triggered a drill suite. */
  async tick(): Promise<boolean> {
    const d = this.now()
    if (!this.inWindow(d)) return false
    // De-duplicate: don't fire twice in the same window.
    if (d.getTime() - this.lastFiredAtMs < 50 * 60 * 1000) return false
    this.lastFiredAtMs = d.getTime()
    await this.injector.runFullSuite()
    return true
  }
}
