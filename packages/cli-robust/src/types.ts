/** Stage B.1 prototype types — scaffolding for SessionProbe + Subscription Budget.
 *  v2.2 M1 expands these with sanitizer + pool + canary harness.
 */

export type HoldReason =
  | 'session_expired'
  | 'quota_exhausted'
  | 'secret_grant_request'
  | 'validator_disagreement'
  | 'production_incident'
  | 'forbidden_path_push'
  | 'sentinel_rejected'

export interface ProbeResult {
  ok: boolean
  ts: string
  /** When ok=false, why; matches the InterruptBus reason vocabulary (Stage C). */
  reason?: Extract<HoldReason, 'session_expired'>
  /** Free-form context; goes into event payload. */
  detail?: Record<string, unknown>
}

/** Anything that can ask "is the CLI subscription still alive?". Real probe in
 *  Stage M1 will hit the keychain + a no-op `claude --print` smoke. Stage B
 *  ships only the harness so HOLD wiring can be tested without a live CLI. */
export type ProbeFn = () => Promise<ProbeResult>

/** Subscription budget — total daily call cap and a soft threshold for warn. */
export interface QuotaPolicy {
  dailyLimit: number
  warnAtFraction: number
  /** Optional explicit reset cadence in ms; defaults to a calendar UTC day. */
  resetIntervalMs?: number
}

export interface QuotaSnapshot {
  callsToday: number
  dailyLimit: number
  fraction: number
  exhausted: boolean
  warned: boolean
  resetsAt: string
}

export interface SessionHealthState {
  /** Most recent successful probe ts. Null until first ok=true. */
  lastOkTs: string | null
  /** Most recent ts at which the session was last observed expired. */
  lastExpiredTs: string | null
  /** Best-effort tri-state derived from the probe stream. */
  status: 'unknown' | 'healthy' | 'expired'
  /** Count of probes processed so far (for visibility / sanity). */
  probes: number
}

export const INITIAL_SESSION_HEALTH: SessionHealthState = {
  lastOkTs: null,
  lastExpiredTs: null,
  status: 'unknown',
  probes: 0,
}
