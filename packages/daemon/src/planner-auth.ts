/**
 * overnight-p1 — honest planner auth-failure detection + opt-in codex fallback policy.
 *
 * The operator's real failure mode: `claude -p` returns 401 (subscription /
 * Agent-SDK auth) and the cockpit planner used to raise a confusing generic
 * HOLD-PLANNER-CLI. These pure helpers:
 *   1. classify a FAILED local-CLI result as an auth failure
 *      (HOLD-PLANNER-AUTH) when the stderr/transcript carries an auth hint, and
 *   2. read the explicit opt-in fallback policy `AEDEV_PLANNER_FALLBACK=codex`.
 *
 * Policy (operator-approved; intentionally relaxes the v3-P1 claude-only
 * planner pin, but ONLY via explicit opt-in): env unset (default) = NO
 * fallback; exactly `codex` = retry once via the local Codex CLI in read-only
 * exec mode. There is NEVER a paid-API fallback (non-negotiable #6 / GR#6),
 * and a fallback run is always recorded as `planner_provider:
 * codex-cli (fallback)` — the system never pretends it was claude.
 */

export const PLANNER_AUTH_HOLD_CODE = 'HOLD-PLANNER-AUTH'
export const PLANNER_FALLBACK_ENV = 'AEDEV_PLANNER_FALLBACK'

/** Hints that a failed CLI run is an auth/subscription problem rather than a
 *  generic CLI breakage. Mirrors what the claude adapter surfaces: stderr in
 *  `error` (e.g. `API Error: 401 ... authentication_error ...`) and the JSON
 *  `result` text in `transcript`. */
const AUTH_HINT = /401|unauthorized|auth|credit|login/i

export interface PlannerCliOutcome {
  exitCode: number
  error?: string | undefined
  transcript?: string | undefined
}

/** Returns the matched auth hint when a FAILED CLI result (exitCode != 0)
 *  looks like an auth/credit/login problem; null for successes and for
 *  failures with no auth hint. */
export function detectPlannerAuthFailure(result: PlannerCliOutcome): { matched: string } | null {
  if (result.exitCode === 0) return null
  for (const text of [result.error, result.transcript]) {
    if (!text) continue
    const match = AUTH_HINT.exec(text)
    if (match) return { matched: match[0] }
  }
  return null
}

/** Explicit opt-in planner fallback. Only the exact value `codex`
 *  (trimmed, case-insensitive) enables it; unset or anything else → null,
 *  i.e. the claude-only planner pin stays in force. */
export function plannerFallbackProvider(env: NodeJS.ProcessEnv = process.env): 'codex' | null {
  return (env[PLANNER_FALLBACK_ENV] ?? '').trim().toLowerCase() === 'codex' ? 'codex' : null
}
