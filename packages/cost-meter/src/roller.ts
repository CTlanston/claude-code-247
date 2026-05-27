/** L2.1 cost-meter — roller (rolling window aggregation).
 *
 * Aggregates per-call cost tags into rolling daily and 7-day windows.
 * The daemon's Prometheus exporter reads from this. The circuit
 * breaker (see breaker.ts) reads from this. The SLA reconciler reads
 * from this.
 */

export interface CostSample {
  /** ISO timestamp of the sampled event. */
  ts: string
  costUsd: number
  /** Optional grouping label — typically the mission_id. */
  bucket?: string
}

export interface RollerSnapshot {
  totalUsd: number
  windowMs: number
  /** Number of samples in the window. */
  count: number
  /** Per-bucket totals (if buckets were provided). */
  byBucket: Record<string, number>
}

export interface CostRollerOpts {
  /** Window length in ms. Default 7d. */
  windowMs?: number
  /** Wall-clock fn (tests inject). */
  now?: () => Date
}

export class CostRoller {
  private samples: CostSample[] = []
  private readonly windowMs: number
  private readonly now: () => Date

  constructor(opts: CostRollerOpts = {}) {
    this.windowMs = opts.windowMs ?? 7 * 24 * 60 * 60 * 1000
    this.now = opts.now ?? (() => new Date())
  }

  record(sample: CostSample): void {
    this.samples.push(sample)
    this.evictOld()
  }

  private evictOld(): void {
    const cutoff = this.now().getTime() - this.windowMs
    // assumes mostly-in-order timestamps; do one pass
    while (this.samples.length > 0 && new Date(this.samples[0].ts).getTime() < cutoff) {
      this.samples.shift()
    }
  }

  snapshot(): RollerSnapshot {
    this.evictOld()
    let total = 0
    const byBucket: Record<string, number> = {}
    for (const s of this.samples) {
      total += s.costUsd
      if (s.bucket) {
        byBucket[s.bucket] = round2((byBucket[s.bucket] ?? 0) + s.costUsd)
      }
    }
    return {
      totalUsd: round2(total),
      windowMs: this.windowMs,
      count: this.samples.length,
      byBucket,
    }
  }

  /** Average cost per bucket (e.g., per autonomous PR). 0 if no buckets. */
  avgPerBucket(): number {
    const snap = this.snapshot()
    const n = Object.keys(snap.byBucket).length
    if (n === 0) return 0
    return round2(snap.totalUsd / n)
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}
