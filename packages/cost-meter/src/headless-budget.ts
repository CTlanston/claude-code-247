/** WORKBOOK_v4 P1 — Agent SDK credit budget (GR#1 revision).
 *
 * From 2026-06-15, headless `claude --print` calls consume a separate,
 * non-rollover Agent SDK monthly credit instead of the normal subscription
 * allowance. Every headless call is therefore a metered resource: it must be
 * recorded as a `cost.headless_call` event and checked against per-mission /
 * per-day caps BEFORE the CLI is spawned. Over budget → HOLD-BUDGET, never a
 * silent fallback to a paid API key (GR#6).
 *
 * This module is pure (no db, no IO) so the verdict logic is trivially
 * testable; the daemon owns event counting and hold creation.
 */

export interface HeadlessBudgetLimits {
  /** Max headless calls attributed to one mission/operator session. */
  maxPerMission: number
  /** Max headless calls across the whole system per UTC day. */
  maxPerDay: number
}

export interface HeadlessBudgetUsage {
  /** Recorded calls for the current mission/operator session. */
  missionCalls: number
  /** Recorded calls across the system for the current UTC day. */
  dayCalls: number
}

export type HeadlessBudgetReason = 'ok' | 'mission_cap' | 'day_cap'

export interface HeadlessBudgetVerdict {
  allowed: boolean
  reason: HeadlessBudgetReason
  usage: HeadlessBudgetUsage
  limits: HeadlessBudgetLimits
}

export const DEFAULT_HEADLESS_LIMITS: HeadlessBudgetLimits = {
  maxPerMission: 15,
  maxPerDay: 60,
}

/** Read limits from the environment; non-numeric/absent values fall back to
 *  defaults. A limit of 0 disables that dimension's calls entirely. */
export function headlessLimitsFromEnv(env: Record<string, string | undefined> = process.env): HeadlessBudgetLimits {
  const read = (key: string, fallback: number): number => {
    const raw = env[key]
    if (raw === undefined || raw.trim() === '') return fallback
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback
  }
  return {
    maxPerMission: read('AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION', DEFAULT_HEADLESS_LIMITS.maxPerMission),
    maxPerDay: read('AEDEV_BUDGET_MAX_HEADLESS_PER_DAY', DEFAULT_HEADLESS_LIMITS.maxPerDay),
  }
}

/** Decide whether ONE MORE headless call is allowed given current usage.
 *  Day cap is checked first: it protects the whole monthly credit pool. */
export function evaluateHeadlessBudget(usage: HeadlessBudgetUsage, limits: HeadlessBudgetLimits = DEFAULT_HEADLESS_LIMITS): HeadlessBudgetVerdict {
  if (usage.dayCalls >= limits.maxPerDay) {
    return { allowed: false, reason: 'day_cap', usage, limits }
  }
  if (usage.missionCalls >= limits.maxPerMission) {
    return { allowed: false, reason: 'mission_cap', usage, limits }
  }
  return { allowed: true, reason: 'ok', usage, limits }
}

/** Human-readable hold reason for HOLD-BUDGET. */
export function describeHeadlessBudgetBlock(v: HeadlessBudgetVerdict): string {
  if (v.reason === 'day_cap') {
    return `Daily headless-call budget reached (${v.usage.dayCalls}/${v.limits.maxPerDay} today). ` +
      'Headless claude calls consume Agent SDK monthly credit; waiting for the next UTC day or an operator override.'
  }
  return `Mission headless-call budget reached (${v.usage.missionCalls}/${v.limits.maxPerMission} for this mission). ` +
    'Headless claude calls consume Agent SDK monthly credit; an operator must raise the cap or resolve the hold.'
}
