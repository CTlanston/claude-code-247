/** NEXT_PLAN_WORKBOOK §3 Phase L2.2 — alert routes.
 *
 * Four routes per workbook: cost / hold-overrun / redteam-leak /
 * uptime. Each route maps a gauge/event observation → an actionable
 * notification (typically through the existing ApprovalGateway's
 * ntfy transport for the operator).
 *
 * The router is intentionally rules-as-data — production wires
 * thresholds from config.yaml; tests use injected snapshots.
 */

export type AlertRouteId = 'cost' | 'hold-overrun' | 'redteam-leak' | 'uptime'

export type AlertSeverity = 'info' | 'warn' | 'critical'

export interface AlertRoute {
  id: AlertRouteId
  /** Human-readable description for the dashboard. */
  description: string
  /** Threshold guidance — exact triggering logic is the predicate. */
  thresholdHint: string
  severity: AlertSeverity
}

export interface SloSnapshot {
  /** §0 sla_after_launch.cost_per_autonomous_pr_usd_7d — rolling 7d avg cost per PR. */
  costPerPrUsd7d: number
  /** §0 hard_cap on cost. */
  hardCapUsd: number
  /** §0 sla_after_launch.hold_mttr_p95_min_7d — hold mean time to resolve. */
  holdMttrP95Min: number
  /** §0 sla_after_launch.daemon_uptime_pct_7d. */
  daemonUptimePct: number
  /** §0 sla_after_launch.sentinel_false_block_rate_7d. */
  sentinelFalseBlockRate: number
  /** Red-team round-3: 1.0 ideal (0/30 missed). Any drop is critical. */
  redteamPassRate: number
}

export interface AlertFiring {
  route: AlertRouteId
  severity: AlertSeverity
  message: string
  observedValue: number
  thresholdValue: number
}

export const DEFAULT_ROUTES: Record<AlertRouteId, AlertRoute> = {
  cost:           { id: 'cost',           description: 'cost_per_pr_usd_7d nearing or over hard cap',  thresholdHint: '80% warn, 100% critical', severity: 'warn' },
  'hold-overrun': { id: 'hold-overrun',   description: 'hold_mttr_p95_min_7d exceeded target',         thresholdHint: '> 30 min',                severity: 'warn' },
  'redteam-leak': { id: 'redteam-leak',   description: 'redteam_pass_rate dropped below 1.00',         thresholdHint: 'any < 1.00',              severity: 'critical' },
  uptime:         { id: 'uptime',         description: 'daemon_uptime_pct_7d below target',            thresholdHint: '< 99.0%',                 severity: 'warn' },
}

/** Stateless evaluator — given a snapshot, return any alerts that
 *  should fire right now. The daemon's scheduler calls this on a
 *  cadence (≤60s for the synthetic-trip case in workbook L1). */
export function evaluate(snap: SloSnapshot): AlertFiring[] {
  const out: AlertFiring[] = []

  // cost
  if (snap.costPerPrUsd7d >= snap.hardCapUsd) {
    out.push({
      route: 'cost', severity: 'critical',
      message: `cost/PR ${snap.costPerPrUsd7d.toFixed(2)} ≥ hard cap ${snap.hardCapUsd.toFixed(2)} — GR12 breached`,
      observedValue: snap.costPerPrUsd7d, thresholdValue: snap.hardCapUsd,
    })
  } else if (snap.costPerPrUsd7d >= 0.8 * snap.hardCapUsd) {
    out.push({
      route: 'cost', severity: 'warn',
      message: `cost/PR ${snap.costPerPrUsd7d.toFixed(2)} ≥ 80% of cap ${(0.8 * snap.hardCapUsd).toFixed(2)}`,
      observedValue: snap.costPerPrUsd7d, thresholdValue: 0.8 * snap.hardCapUsd,
    })
  }

  // hold overrun
  if (snap.holdMttrP95Min > 30) {
    out.push({
      route: 'hold-overrun', severity: 'warn',
      message: `hold MTTR p95 ${snap.holdMttrP95Min.toFixed(1)} min > 30 min target`,
      observedValue: snap.holdMttrP95Min, thresholdValue: 30,
    })
  }

  // red-team leak
  if (snap.redteamPassRate < 1.0) {
    out.push({
      route: 'redteam-leak', severity: 'critical',
      message: `red-team pass rate ${(snap.redteamPassRate * 100).toFixed(1)}% — sentinel missed a prompt`,
      observedValue: snap.redteamPassRate, thresholdValue: 1.0,
    })
  }

  // uptime
  if (snap.daemonUptimePct < 99.0) {
    out.push({
      route: 'uptime', severity: 'warn',
      message: `daemon uptime ${snap.daemonUptimePct.toFixed(2)}% < 99.0% target`,
      observedValue: snap.daemonUptimePct, thresholdValue: 99.0,
    })
  }

  return out
}
