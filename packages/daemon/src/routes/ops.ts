/**
 * cloudhull-c6 — the owner's single "Operations" view.
 *
 * GET /ops/overview answers "is the team healthy and what should I do" in one
 * read-only payload. Everything is derived from the event log, active hold
 * rows, and config/env — ZERO LLM calls and ZERO subprocess spawns (GR#8):
 * probing `claude` is itself a metered headless call that costs subscription
 * credit, so engine health is inferred from RECENT recorded events only.
 */
import type { FastifyInstance } from 'fastify'
import type { AedevDb, Event } from '@aedev/core'
import { explainBlockingCode } from '../user-state.js'
import { allowRemoteWritesEnabled, remoteWriteWhitelist } from '../remote-write-policy.js'
import { PLANNER_AUTH_HOLD_CODE } from '../planner-auth.js'
import { HEADLESS_CALL_EVENT } from '../headless-budget-guard.js'

export type EngineStatus = 'unknown' | 'ready' | 'needs_login' | 'not_configured'

export interface OpsHoldView {
  code: string
  /** Humanized sentence (user-state mapping) — safe to render verbatim. */
  text: string
  entityType: string
  entityId: string
  createdAt: string
}

export interface OpsOverview {
  activeHolds: OpsHoldView[]
  activeMissions: Array<{ id: string; title: string; status: string; submittedBy: string }>
  lastValidator: { status: string; verdict: string | null; atIso: string } | null
  remoteWrites: { enabled: boolean; whitelist: string[] }
  engines: { claude: EngineStatus; codex: EngineStatus; gemini: EngineStatus }
  suggestedRecovery: string[]
}

export interface OpsRouteOptions {
  /** Engine-config env (gemini key presence); injectable for tests. */
  env?: NodeJS.ProcessEnv
}

/** Exact plain-language action for a claude auth failure (asserted by tests
 *  and mirrored on the dashboard recovery card). */
export const CLAUDE_LOGIN_RECOVERY =
  'Claude planner needs login on this Mac · 在这台 Mac 上运行 claude login'
export const GEMINI_NOT_CONFIGURED_RECOVERY =
  'Independent result review is off — add a Gemini key (GEMINI_API_KEY) so finished work gets checked · 配置 Gemini 密钥以启用独立评审'

/** "Recent" = the newest slice of the event log; old history must not keep an
 *  engine flagged forever once newer signals exist. */
const RECENT_EVENT_LIMIT = 500

const TERMINAL_MISSION_STATUSES = new Set(['done', 'failed', 'cancelled'])
const GEMINI_KEY_ENVS = ['AEDEV_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY']

export function registerOpsRoutes(
  app: FastifyInstance,
  db: AedevDb,
  stateDir: string,
  options: OpsRouteOptions = {},
): void {
  app.get('/ops/overview', async (): Promise<OpsOverview> => {
    const env = options.env ?? process.env
    const engines = {
      claude: deriveClaudeStatus(db),
      codex: deriveCodexStatus(db),
      gemini: GEMINI_KEY_ENVS.some((k) => Boolean(env[k]?.trim()))
        ? 'ready' as const
        : 'not_configured' as const,
    }
    const activeHolds = db.listActiveHolds().map((h) => ({
      code: h.code,
      text: explainBlockingCode(h.code),
      entityType: h.entityType,
      entityId: h.entityId,
      createdAt: h.createdAt,
    }))
    return {
      activeHolds,
      activeMissions: listActiveMissions(db),
      lastValidator: deriveLastValidator(db),
      remoteWrites: {
        enabled: allowRemoteWritesEnabled(stateDir),
        whitelist: remoteWriteWhitelist(stateDir),
      },
      engines,
      suggestedRecovery: deriveSuggestedRecovery(engines, activeHolds),
    }
  })
}

function latestEvent(db: AedevDb, type: string, match: (e: Event) => boolean): Event | undefined {
  return db.queryEvents({ type, limit: RECENT_EVENT_LIMIT }).find(match)
}

function holdCodeOf(e: Event): string {
  return String(e.payload['holdCode'] ?? e.payload['code'] ?? '')
}

/** claude planner health from recorded events only — never a probe.
 *  Newest signal wins: an auth-failure hold says needs_login until a newer
 *  resolution or a newer successful metered call appears. */
function deriveClaudeStatus(db: AedevDb): EngineStatus {
  const authHold = latestEvent(db, 'operator.hold_created', (e) => holdCodeOf(e).startsWith(PLANNER_AUTH_HOLD_CODE))
  const authResolved = latestEvent(db, 'operator.hold_resolved', (e) => holdCodeOf(e).startsWith(PLANNER_AUTH_HOLD_CODE))
  const okCall = latestSuccessfulCall(db, 'claude-cli')
  if (authHold) {
    const newerSignals = [authResolved, okCall].filter((e): e is Event => e !== undefined)
    if (newerSignals.every((e) => e.createdAt < authHold.createdAt)) return 'needs_login'
  }
  if (okCall) return 'ready'
  return 'unknown'
}

function deriveCodexStatus(db: AedevDb): EngineStatus {
  return latestSuccessfulCall(db, 'codex-cli') ? 'ready' : 'unknown'
}

function latestSuccessfulCall(db: AedevDb, provider: string): Event | undefined {
  return latestEvent(db, HEADLESS_CALL_EVENT, (e) => e.payload['provider'] === provider && e.payload['exitCode'] === 0)
}

/** Latest validator signal: a real verdict beats (and outdates) the honest
 *  "review not configured" marker when it is newer. */
function deriveLastValidator(db: AedevDb): OpsOverview['lastValidator'] {
  const result = db.queryEvents({ type: 'operator.validator_result', limit: 1 })[0]
  const notConfigured = db.queryEvents({ type: 'operator.validators_not_configured', limit: 1 })[0]
  if (result && (!notConfigured || notConfigured.createdAt <= result.createdAt)) {
    return { status: 'done', verdict: String(result.payload['verdict'] ?? ''), atIso: result.createdAt }
  }
  if (notConfigured) {
    return { status: 'not_configured', verdict: null, atIso: notConfigured.createdAt }
  }
  return null
}

function listActiveMissions(db: AedevDb): OpsOverview['activeMissions'] {
  const submittedByMission = new Map<string, string>()
  // listOperatorSessions is newest-first; keep the newest attribution per mission
  for (const s of db.listOperatorSessions()) {
    if (s.missionId && !submittedByMission.has(s.missionId)) {
      submittedByMission.set(s.missionId, s.submittedBy ?? 'owner')
    }
  }
  return db.listMissions()
    .filter((m) => !TERMINAL_MISSION_STATUSES.has(m.status))
    .map((m) => ({
      id: m.id,
      title: m.title,
      status: m.status,
      submittedBy: submittedByMission.get(m.id) ?? 'owner',
    }))
}

/** Plain-language actions, most actionable first. Pure derivation from the
 *  fields above — no model, no probe, no guesswork. */
function deriveSuggestedRecovery(
  engines: OpsOverview['engines'],
  activeHolds: OpsHoldView[],
): string[] {
  const actions: string[] = []
  if (engines.claude === 'needs_login') actions.push(CLAUDE_LOGIN_RECOVERY)
  for (const hold of activeHolds) {
    // claude auth holds are already covered by the login action above
    if (hold.code.startsWith(PLANNER_AUTH_HOLD_CODE)) continue
    actions.push(hold.text)
  }
  if (engines.gemini === 'not_configured') actions.push(GEMINI_NOT_CONFIGURED_RECOVERY)
  return [...new Set(actions)]
}
