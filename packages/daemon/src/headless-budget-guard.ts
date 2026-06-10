/** WORKBOOK_v4 P1 — daemon side of the Agent SDK credit guard.
 *
 * Counts `cost.headless_call` events straight from the event store (GR#5:
 * the daily/mission tallies must be reconstructable from events alone),
 * evaluates the pure budget from @aedev/cost-meter before a headless claude
 * call is spawned, and on a block creates exactly one active HOLD-BUDGET per
 * session plus an ntfy notification. Never falls back to a paid API (GR#6).
 */
import type { AedevDb } from '@aedev/core'
import { sendNtfy } from './ntfy.js'
import {
  describeHeadlessBudgetBlock,
  evaluateHeadlessBudget,
  headlessLimitsFromEnv,
  type HeadlessBudgetVerdict,
} from '@aedev/cost-meter'

export const HEADLESS_CALL_EVENT = 'cost.headless_call'
export const HOLD_BUDGET_CODE = 'HOLD-BUDGET'

export interface HeadlessBudgetContext {
  db: AedevDb
  sessionId: string
}

export interface HeadlessCallRecord {
  role: string
  provider: string
  authMode?: string | undefined
  inputTokens?: number | undefined
  outputTokens?: number | undefined
  exitCode?: number | undefined
}

/** Count today's headless calls system-wide. UTC day from the event's
 *  ISO `createdAt`, so the count is derived purely from the event log. */
export function countHeadlessCallsToday(db: AedevDb, now: Date = new Date()): number {
  const day = now.toISOString().slice(0, 10)
  return db.queryEvents({ type: HEADLESS_CALL_EVENT })
    .filter((e) => e.createdAt.slice(0, 10) === day)
    .length
}

/** Count headless calls recorded against one operator session/mission. */
export function countHeadlessCallsForSession(db: AedevDb, sessionId: string): number {
  return db.queryEvents({ type: HEADLESS_CALL_EVENT, entityId: sessionId }).length
}

/** Record one headless call. MUST be called for every spawned
 *  `claude --print`, success or failure — a failed call still consumed
 *  Agent SDK credit. */
export function recordHeadlessCall(db: AedevDb, sessionId: string | null, record: HeadlessCallRecord): void {
  db.insertEvent(HEADLESS_CALL_EVENT, 'operator_session', sessionId ?? undefined, {
    role: record.role,
    provider: record.provider,
    ...(record.authMode !== undefined ? { authMode: record.authMode } : {}),
    ...(record.inputTokens !== undefined ? { inputTokens: record.inputTokens } : {}),
    ...(record.outputTokens !== undefined ? { outputTokens: record.outputTokens } : {}),
    ...(record.exitCode !== undefined ? { exitCode: record.exitCode } : {}),
  })
}

/** Evaluate the budget for one more call attributed to this session. */
export function checkHeadlessBudget(db: AedevDb, sessionId: string, now: Date = new Date()): HeadlessBudgetVerdict {
  return evaluateHeadlessBudget(
    {
      missionCalls: countHeadlessCallsForSession(db, sessionId),
      dayCalls: countHeadlessCallsToday(db, now),
    },
    headlessLimitsFromEnv(),
  )
}

/** Create the HOLD-BUDGET (idempotent per session while unresolved), emit the
 *  hold event, and request an ntfy notification. Returns the hold reason. */
export function createBudgetHold(db: AedevDb, sessionId: string, verdict: HeadlessBudgetVerdict): string {
  const reason = describeHeadlessBudgetBlock(verdict)
  const alreadyHeld = db.listHolds(sessionId).some((h) => h.code === HOLD_BUDGET_CODE && h.status === 'active')
  db.insertEvent('operator.hold_created', 'operator_session', sessionId, {
    holdCode: HOLD_BUDGET_CODE,
    reason,
    budgetReason: verdict.reason,
    usage: { missionCalls: verdict.usage.missionCalls, dayCalls: verdict.usage.dayCalls },
    limits: { maxPerMission: verdict.limits.maxPerMission, maxPerDay: verdict.limits.maxPerDay },
  })
  if (!alreadyHeld) {
    db.insertHold({
      entityType: 'operator_session',
      entityId: sessionId,
      code: HOLD_BUDGET_CODE,
      reason,
      nextAction: 'Raise AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION / AEDEV_BUDGET_MAX_HEADLESS_PER_DAY, or wait for the daily window, then resolve the hold.',
    })
    void notifyBudgetHold(db, sessionId, reason)
  }
  return reason
}

/** Record the claude-cli discovery probe when it actually ran — the probe is
 *  itself a headless `claude --print` call and consumes credit. */
export function recordDiscoveryProbe(
  db: AedevDb,
  sessionId: string | null,
  sessions: Array<{ provider?: string; probeStatus?: string }>,
): void {
  const claude = sessions.find((s) => s.provider === 'claude-cli')
  if (!claude || claude.probeStatus === 'skipped' || claude.probeStatus === undefined) return
  recordHeadlessCall(db, sessionId, {
    role: 'worker-discovery',
    provider: 'claude-cli',
    exitCode: claude.probeStatus === 'ok' ? 0 : 1,
  })
}

/** Fire-and-forget ntfy push (when AEDEV_NTFY_TOPIC is configured) plus an
 *  always-on `operator.notify_requested` event so the notification intent is
 *  itself event-sourced and testable without network. */
export async function notifyBudgetHold(db: AedevDb, sessionId: string, reason: string): Promise<void> {
  db.insertEvent('operator.notify_requested', 'operator_session', sessionId, {
    channel: 'ntfy',
    holdCode: HOLD_BUDGET_CODE,
    reason,
  })
  await sendNtfy(`aedev ${HOLD_BUDGET_CODE}`, `${HOLD_BUDGET_CODE} (${sessionId}): ${reason}`, 'high')
}
