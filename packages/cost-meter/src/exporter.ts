/** L2.1 cost-meter — Prometheus exporter.
 *
 * Renders cost gauges in the same shape as @aedev/daemon/obs/metrics.
 * The daemon's PromRegistry can scrape these directly.
 */
import type { CostRoller } from './roller.js'

export interface CostGauges {
  /** Total USD spent in the current rolling window. */
  cost_total_usd: number
  /** Average cost per mission/PR in the window. */
  cost_per_pr_usd_7d: number
  /** Number of cost-bearing events in the window. */
  cost_event_count: number
  /** Distinct mission/PR buckets in the window. */
  cost_bucket_count: number
}

export function gaugesFrom(roller: CostRoller): CostGauges {
  const snap = roller.snapshot()
  const bucketCount = Object.keys(snap.byBucket).length
  return {
    cost_total_usd: snap.totalUsd,
    cost_per_pr_usd_7d: roller.avgPerBucket(),
    cost_event_count: snap.count,
    cost_bucket_count: bucketCount,
  }
}

/** Render as Prometheus text exposition format. */
export function renderProm(gauges: CostGauges): string {
  const lines: string[] = []
  lines.push('# HELP cost_total_usd Total subscription/API spend in the rolling cost window (USD)')
  lines.push('# TYPE cost_total_usd gauge')
  lines.push(`cost_total_usd ${gauges.cost_total_usd}`)
  lines.push('# HELP cost_per_pr_usd_7d Average USD spent per autonomous PR over the rolling 7d window')
  lines.push('# TYPE cost_per_pr_usd_7d gauge')
  lines.push(`cost_per_pr_usd_7d ${gauges.cost_per_pr_usd_7d}`)
  lines.push('# HELP cost_event_count Number of cost-bearing events in the window')
  lines.push('# TYPE cost_event_count gauge')
  lines.push(`cost_event_count ${gauges.cost_event_count}`)
  lines.push('# HELP cost_bucket_count Distinct missions/PRs in the cost window')
  lines.push('# TYPE cost_bucket_count gauge')
  lines.push(`cost_bucket_count ${gauges.cost_bucket_count}`)
  return lines.join('\n') + '\n'
}
