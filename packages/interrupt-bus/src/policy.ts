/** Stage C — InterruptBus policy table (workbook §8.1). */

export type HoldReason =
  | 'session_expired'
  | 'quota_exhausted'
  | 'secret_grant_request'
  | 'validator_disagreement'
  | 'production_incident'
  | 'forbidden_path_push'
  | 'sentinel_rejected'
  | 'cost_cap_breached'    // NEXT_PLAN_WORKBOOK §1 GR12 — daemon-side hard cost cap
  | 'roadmap_scan_overflow' // CC_RESTORE_SPEC T3 — RoadmapAgent emitted > max_proposals_per_tick

export type OnTimeout = 'retry-3' | 'drop' | 'escalate' | 'halt'

export interface HoldPolicy {
  /** Time-to-live in ms before the escalator acts. Infinity = manual-only. */
  ttlMs: number
  /** What the escalator does at TTL expiry. */
  onTimeout: OnTimeout
}

const MIN = 60 * 1000

export const HOLD_POLICIES: Record<HoldReason, HoldPolicy> = {
  session_expired:        { ttlMs:  5 * MIN, onTimeout: 'retry-3' },
  quota_exhausted:        { ttlMs: 30 * MIN, onTimeout: 'drop'    },
  secret_grant_request:   { ttlMs: Infinity, onTimeout: 'halt'    },
  validator_disagreement: { ttlMs: 30 * MIN, onTimeout: 'escalate' },
  production_incident:    { ttlMs: Infinity, onTimeout: 'halt'    },
  forbidden_path_push:    { ttlMs: Infinity, onTimeout: 'halt'    },
  sentinel_rejected:      { ttlMs: 15 * MIN, onTimeout: 'escalate' },
  cost_cap_breached:      { ttlMs: Infinity, onTimeout: 'halt'    },
  roadmap_scan_overflow:  { ttlMs: Infinity, onTimeout: 'halt'    },
}

export function policyFor(reason: HoldReason): HoldPolicy {
  return HOLD_POLICIES[reason]
}
