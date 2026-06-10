import { execFileSync } from 'child_process'
import { appendFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import type { FastifyInstance } from 'fastify'
import type { AedevDb, MissionArtifact, MissionDesign, OperatorChoice, OperatorMessageMeta, OperatorQuestion, Run, Task, ValidatorResult } from '@aedev/core'
import { generateId, nowIso, validateMissionDesign } from '@aedev/core'
import {
  ClaudeCodeAdapter,
  ClaudeDockerRunner,
  CodexCliAdapter,
  TARGET_REPO_HOLD,
  TargetRepoUnavailableError,
  collectWorkspaceDiff,
  createRepoBoundWorkspace,
  discoverWorkerSessions,
  validateTargetRepo,
} from '@aedev/runner'
import type { ClarificationField, ClarificationQuestion } from '../clarification-gate.js'
import { ClarificationGate, scoreAmbiguity } from '../clarification-gate.js'
import { skipFinalWriteIfCancelled } from '../cancellation.js'
import { MockValidator } from '@aedev/validators'
import { buildMemoryContext, compileTier2LessonsToTier1, projectTier2Lessons } from '@aedev/memory'
import { IntakeService } from '../intake.js'
import { MissionRunner } from '../mission-runner.js'
import { RolePipeline } from '../roles/role-pipeline.js'
import { LeadAgent } from '../lead-agent.js'
import type { DraftPrInfo, DraftPrRequest } from '../draft-pr-gate.js'
import { DraftPrGate, DraftPrGateError } from '../draft-pr-gate.js'
import { createDefaultMissionValidatorFactory, inspectDefaultMissionValidatorSecrets } from '../validator-factory.js'
import { allowRemoteWritesEnabled, remoteWriteWhitelist } from '../remote-write-policy.js'
import { buildPlannerCoderEnv } from '../no-paid-api-guard.js'
import {
  HOLD_BUDGET_CODE,
  checkHeadlessBudget,
  countHeadlessCallsToday,
  createBudgetHold,
  recordDiscoveryProbe,
  recordHeadlessCall,
} from '../headless-budget-guard.js'
import { ClaudeReviewer, type ReviewVerdict } from '../claude-reviewer.js'

type Stage =
  | 'Intake'
  | 'Brainstorm'
  | 'PRD'
  | 'ADR'
  | 'Roadmap'
  | 'Approved'
  | 'Worker'
  | 'Tests'
  | 'Validators'
  | 'PR/Waiting/Blocked'

type OperatorMissionStage =
  | 'intake'
  | 'new'
  | 'understanding'
  | 'understanding_ready'
  | 'brainstorming'
  | 'clarifying'
  | 'roadmap_ready'
  | 'pending_approval'
  | 'approved'
  | 'running'
  | 'evidence_ready'
  | 'validating'
  | 'validators_ready'
  | 'validators_missing'
  | 'pr_blocked'
  | 'pr_ready'
  | 'pr_created'
  | 'learned'
  | 'failed'
  | 'cancelled'

interface ProviderMode {
  name: string
  mode: 'subscription-local' | 'validator-api-only' | 'paid-api-fallback' | 'mock' | 'not_configured' | 'unknown'
  status?: string
  tokens?: number | null
  costUsd?: number | null
}

interface OperatorActionView {
  id: 'start-brainstorm' | 'generate-plan' | 'approve-roadmap' | 'start-execution' | 'check-draft-pr-gate' | 'resume' | 'pause' | 'start-over'
  label: string
  kind: 'primary' | 'secondary'
  disabled?: boolean
}

interface OperatorMissionView {
  stage: OperatorMissionStage
  stageLabel: string
  confidence: number
  progressPercent: number
  /** P1 — today's metered headless claude calls, derived from events. */
  headlessCallsToday: number
  primaryAction?: OperatorActionView
  secondaryActions: OperatorActionView[]
  providerSummary: {
    planner?: ProviderMode
    worker?: ProviderMode
    validators: ProviderMode[]
  }
  safetySummary: {
    remoteWrites: 'enabled' | 'disabled'
    prGate?: { status: 'blocked' | 'ready' | 'created'; code?: string; reason?: string; remediation?: string }
    testMode?: { enabled: boolean; reason: string }
  }
  understanding: {
    roundsCompleted: number
    questions: OperatorQuestion[]
    readyReason?: string
  }
  projectPulse: {
    progress: Array<{ id: string; label: string; status: 'done' | 'active' | 'pending' | 'blocked'; detail?: string }>
    workingFolder?: string
    touchedFiles: string[]
    evidence: Array<{ id: string; title: string; path: string; type: string }>
    validatorReviews: Array<{
      id: string
      validator: string
      verdict: string
      summary: string
      checkedEvidence: string[]
      blockingIssues: string[]
      evidenceGaps: string[]
      recommendedNextAction: string
    }>
  }
  memorySummary: {
    projectFacts: Array<{ id: string; kind: string; text: string; provenance: string; ttlDays: number; superseded: boolean }>
    userPreferences: Array<{ id: string; kind: string; text: string; provenance: string; ttlDays: number; superseded: boolean }>
    recentLessons: Array<{ id: string; kind: string; text: string; provenance: string; ttlDays: number; superseded: boolean }>
  }
  summary: string
  nextAction: string
  testMode: boolean
}

interface OperatorSessionBody {
  repoId?: string
  title?: string
  prompt?: string
}

interface ParsedClarification {
  questions: OperatorQuestion[]
  cleaned: string
  confidence?: number
  rationale?: string
}

interface ClarifyGateState {
  unlocked: boolean
  confidence: number
  rationale?: string
  pendingQuestions: OperatorQuestion[]
  roundsCompleted: number
  reason: string
}

export interface OperatorDraftPrExecutor {
  openDraftPr(req: DraftPrRequest): Promise<DraftPrInfo>
}

export interface OperatorRouteOptions {
  draftPrExecutor?: OperatorDraftPrExecutor
}

class DraftPrExecutorUnavailableError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'DraftPrExecutorUnavailableError'
  }
}

type GeminiPrGate =
  | { ok: true; result: ValidatorResult }
  | { ok: false; code: 'GEMINI_NOT_CONFIGURED' | 'GEMINI_NOT_PASS'; reason: string; result?: ValidatorResult }

function evaluateGeminiPrGate(validators: ValidatorResult[]): GeminiPrGate {
  const [latestGemini] = validators
    .filter((v) => v.validator === 'gemini')
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
  if (!latestGemini) {
    return {
      ok: false,
      code: 'GEMINI_NOT_CONFIGURED',
      reason: 'Gemini hard gate has no evidence-only PASS verdict for this mission.',
    }
  }
  if (latestGemini.verdict !== 'pass') {
    return {
      ok: false,
      code: 'GEMINI_NOT_PASS',
      reason: `Gemini hard gate returned ${latestGemini.verdict}: ${latestGemini.summary ?? 'no summary provided'}`,
      result: latestGemini,
    }
  }
  return { ok: true, result: latestGemini }
}

function renderGeminiPrGateBubble(gate: Exclude<GeminiPrGate, { ok: true }>): string {
  const verdict = gate.result?.verdict ?? 'not_configured'
  return [
    'Gemini hard gate blocked Draft PR.',
    '',
    `Verdict: ${verdict}`,
    `Reason: ${gate.reason}`,
    '',
    'Next repair round: fix the evidence/diff issue Gemini called out, run the worker again, then re-check the Draft PR gate. No push or PR was attempted.',
  ].join('\n')
}

/** P2 — the cross-engine review verdict, rendered into the conversation. */
function renderReviewVerdictBubble(verdict: ReviewVerdict, cycle: number): string {
  if (verdict.verdict === 'approve') {
    return [
      `Claude review (cycle ${cycle}): APPROVE · 过程内审查通过`,
      '',
      `Confidence: ${Math.round(verdict.confidence)}%`,
      ...(verdict.findings.length ? ['', 'Notes:', ...verdict.findings.map((f) => `- ${f}`)] : []),
      '',
      'Gemini remains the final evidence-only judge before any Draft PR.',
    ].join('\n')
  }
  return [
    `Claude review (cycle ${cycle}): REWORK · 审查要求返工`,
    '',
    'Findings (the coder repairs all of these next round):',
    ...verdict.findings.map((f) => `- ${f}`),
    '',
    `Confidence: ${Math.round(verdict.confidence)}%`,
  ].join('\n')
}

export function registerOperatorRoutes(app: FastifyInstance, db: AedevDb, stateDir: string, options: OperatorRouteOptions = {}): void {
  const intake = new IntakeService(db, stateDir)

  app.get<{ Querystring: { latest?: string } }>('/operator/sessions', async (req) => {
    const sessions = db.listOperatorSessions()
    if (req.query.latest === '1') {
      const session = sessions[0]
      return session ? { session, messages: db.listOperatorMessages(session.id) } : { session: null, messages: [] }
    }
    return { sessions }
  })

  app.post<{ Body: OperatorSessionBody }>('/operator/sessions', async (req, reply) => {
    const prompt = req.body.prompt?.trim()
    if (!prompt) return reply.code(400).send({ error: 'prompt is required' })
    const title = req.body.title?.trim() || prompt.slice(0, 80)
    const repoId = ensureOperatorRepo(db, req.body.repoId)
    const session = db.insertOperatorSession({
      repoId,
      title,
      prompt,
      status: 'brainstorming',
    })
    db.insertOperatorMessage({ sessionId: session.id, role: 'user', content: prompt })
    db.insertEvent('operator.stage_changed', 'operator_session', session.id, { stage: 'Brainstorm', repoId })
    db.insertOperatorMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Brainstorm is running on the local planner CLI. This can take a minute; the conversation will update automatically.',
      meta: thinkingMeta(),
    })
    db.insertEvent('operator.session.created', 'operator_session', session.id, { repoId })
    const brainstormPromise = completePlannerBrainstorm(db, stateDir, session.id, prompt, title, repoId)
    if (isTestRuntime()) {
      await brainstormPromise
    } else {
      void brainstormPromise
    }
    return { session: db.getOperatorSession(session.id), messages: db.listOperatorMessages(session.id) }
  })

  app.get<{ Params: { id: string } }>('/operator/sessions/:id', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session) return reply.code(404).send({ error: 'session not found' })
    return { session, messages: db.listOperatorMessages(session.id) }
  })

  app.post<{ Params: { id: string }; Body: { role?: 'user' | 'assistant' | 'system'; content?: string } }>(
    '/operator/sessions/:id/messages',
    async (req, reply) => {
      const session = db.getOperatorSession(req.params.id)
      if (!session) return reply.code(404).send({ error: 'session not found' })
      const content = req.body.content?.trim()
      if (!content) return reply.code(400).send({ error: 'content is required' })
      const message = db.insertOperatorMessage({ sessionId: session.id, role: req.body.role ?? 'user', content })
      db.insertEvent('operator.message.added', 'operator_session', session.id, { role: message.role })
      return { message, messages: db.listOperatorMessages(session.id) }
    },
  )

  app.post<{ Params: { id: string }; Body: { prompt?: string } }>('/operator/sessions/:id/ask', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session) return reply.code(404).send({ error: 'session not found' })
    const requestPrompt = req.body.prompt?.trim() || '请先不要执行。请提出你还需要确认的问题，直到你对需求达到至少 95% 的自信度。'
    const repoId = ensureOperatorRepo(db, session.repoId)
    db.insertOperatorMessage({ sessionId: session.id, role: 'user', content: requestPrompt })
    db.insertEvent('operator.message.added', 'operator_session', session.id, { role: 'user' })
    db.insertOperatorMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Planner is preparing clarifying questions. · AI 正在准备需要你确认的问题，稍后会自动更新。',
      meta: thinkingMeta(),
    })
    db.updateOperatorSession(session.id, { status: 'brainstorming' })
    const followupPromise = completePlannerFollowup(db, stateDir, session.id, requestPrompt, session.title, repoId, session.prompt)
    if (isTestRuntime()) {
      await followupPromise
    } else {
      void followupPromise
    }
    return { session: db.getOperatorSession(session.id), messages: db.listOperatorMessages(session.id) }
  })

  app.post<{ Params: { id: string }; Body: { answers?: { questionId: string; value: string }[] } }>(
    '/operator/sessions/:id/answer-questions',
    async (req, reply) => {
      const session = db.getOperatorSession(req.params.id)
      if (!session) return reply.code(404).send({ error: 'session not found' })
      const answers = (req.body.answers ?? []).filter((a) => a && a.questionId && typeof a.value === 'string' && a.value.trim())
      if (answers.length === 0) return reply.code(400).send({ error: 'answers are required' })
      const messages = db.listOperatorMessages(session.id)
      const byId = new Map(
        messages.flatMap((m) => m.questions ?? []).map((q) => [q.id, q]),
      )
      const lines = answers.map((a) => `- ${byId.get(a.questionId)?.question ?? a.questionId} → ${a.value.trim()}`)
      db.insertOperatorMessage({ sessionId: session.id, role: 'user', content: ['已确认 · Clarifications', '', ...lines].join('\n') })
      db.insertEvent('operator.questions_answered', 'operator_session', session.id, {
        answers: answers.map((a) => {
          const question = byId.get(a.questionId)
          return {
            questionId: a.questionId,
            field: question?.field,
            question: question?.question,
            value: a.value.trim(),
          }
        }),
      })
      const gateState = evaluateClarifyGate(db, session.id)
      db.updateOperatorSession(session.id, { status: gateState.unlocked ? 'brainstorm_ready' : 'clarifying' })
      return { session: db.getOperatorSession(session.id), messages: db.listOperatorMessages(session.id) }
    },
  )

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/generate-roadmap', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session) return reply.code(404).send({ error: 'session not found' })
    const repoId = ensureOperatorRepo(db, session.repoId)
    const clarifyGate = blockForClarifyGate(db, session.id, 'generate-roadmap')
    if (clarifyGate.blocked) {
      db.updateOperatorSession(session.id, { status: 'clarifying' })
      return reply.code(409).send({
        session: db.getOperatorSession(session.id),
        messages: db.listOperatorMessages(session.id),
        blocked: {
          code: 'CLARIFY_GATE_BLOCKED',
          reason: clarifyGate.state.reason,
          confidence: clarifyGate.state.confidence,
          threshold: 95,
          pendingQuestionIds: clarifyGate.state.pendingQuestions.map((q) => q.id),
        },
        hold: { code: 'CLARIFY_GATE_BLOCKED', reason: clarifyGate.state.reason },
      })
    }
    db.insertEvent('operator.roadmap_generation_started', 'operator_session', session.id, { repoId })
    const generated = await generateRoadmapDesign(db, stateDir, intake, repoId, session)
    if (!generated.ok) {
      db.updateOperatorSession(session.id, { status: 'hold' })
      db.insertOperatorMessage({ sessionId: session.id, role: 'assistant', content: generated.message })
      db.insertEvent('operator.hold_created', 'operator_session', session.id, {
        holdCode: 'HOLD-ROADMAP-PLANNER',
        reason: generated.reason,
      })
      db.insertHold({ entityType: 'operator_session', entityId: session.id, code: 'HOLD-ROADMAP-PLANNER', reason: generated.reason })
      return {
        session: db.getOperatorSession(session.id),
        messages: db.listOperatorMessages(session.id),
        hold: { code: 'HOLD-ROADMAP-PLANNER', reason: generated.reason },
      }
    }
    const mission = intake.requestApproval(generated.mission.id)
    db.updateOperatorSession(session.id, { missionId: mission.id, status: 'roadmap_ready' })
    resolveSessionHolds(db, session.id) // a successful roadmap supersedes any prior planner HOLD (PRD §D)
    registerDesignArtifacts(db, stateDir, mission.id)
    db.insertOperatorMessage({
      sessionId: session.id,
      role: 'assistant',
      content: `Generated AI-backed PRD, ADR draft, roadmap, and task DAG for mission ${mission.id}.`,
    })
    db.insertEvent('operator.roadmap_generation_done', 'mission', mission.id, { sessionId: session.id })
    db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'Roadmap', sessionId: session.id })
    return {
      session: db.getOperatorSession(session.id),
      mission,
      design: intake.getDesign(mission.id),
      artifacts: db.listMissionArtifacts(mission.id),
      messages: db.listOperatorMessages(session.id),
    }
  })

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/approve-roadmap', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session?.missionId) return reply.code(404).send({ error: 'session or mission not found' })
    try {
      const mission = db.getMission(session.missionId)
      if (!mission) return reply.code(404).send({ error: 'mission not found' })
      if (mission.status === 'draft') intake.requestApproval(mission.id)
      const approved = intake.approveMission(mission.id, 'operator-cockpit')
      db.updateOperatorSession(session.id, { status: 'approved' })
      db.insertEvent('operator.approval_recorded', 'mission', mission.id, { sessionId: session.id, by: 'operator-cockpit' })
      db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'Approved', sessionId: session.id })
      return { session: db.getOperatorSession(session.id), mission: approved, overview: buildMissionOverview(db, approved.id, stateDir) }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/start', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (session) {
      const clarifyGate = blockForClarifyGate(db, session.id, 'start')
      if (clarifyGate.blocked) {
        db.updateOperatorSession(session.id, { status: 'clarifying' })
        return reply.code(409).send({
          session: db.getOperatorSession(session.id),
          result: { status: 'blocked', mergeDecision: 'BLOCKED' },
          blocked: {
            code: 'CLARIFY_GATE_BLOCKED',
            reason: clarifyGate.state.reason,
            confidence: clarifyGate.state.confidence,
            threshold: 95,
            pendingQuestionIds: clarifyGate.state.pendingQuestions.map((q) => q.id),
          },
          hold: { code: 'CLARIFY_GATE_BLOCKED', reason: clarifyGate.state.reason },
        })
      }
    }
    if (!session?.missionId) return reply.code(404).send({ error: 'session or mission not found' })
    const mission = db.getMission(session.missionId)
    if (!mission) return reply.code(404).send({ error: 'mission not found' })
    if (mission.status !== 'approved') return reply.code(400).send({ error: 'roadmap must be approved before execution' })

    // P0 trust fix: on the real (non-mock) path, the worker must run inside the
    // operator's selected git repo.  Pre-flight it here so an unavailable repo
    // HOLDs immediately — we never start a worker that would write throwaway
    // files in a scratch dir and report "done".
    if (!operatorForceMock()) {
      const preflight = await validateTargetRepo(db.getRepo(mission.repoId))
      if (!preflight.ok) {
        db.updateOperatorSession(session.id, { status: 'hold' })
        db.insertEvent('operator.hold_created', 'mission', mission.id, { holdCode: preflight.code, reason: preflight.reason, sessionId: session.id })
        db.insertHold({ entityType: 'mission', entityId: mission.id, code: preflight.code, reason: preflight.reason, nextAction: 'Register a valid, enabled git repo for this mission, then start again.' })
        // 200 + structured hold (matches the generate-roadmap HOLD contract) so the
        // cockpit surfaces the reason instead of a thrown HTTP error. The mission is
        // NOT marked running/done — it stays approved with an active HOLD.
        return {
          session: db.getOperatorSession(session.id),
          result: { status: 'blocked', mergeDecision: 'BLOCKED' },
          hold: { code: preflight.code, reason: preflight.reason },
          overview: buildMissionOverview(db, mission.id, stateDir),
        }
      }
    }
    try {
      // Authoritative status: flip mission + session to running BEFORE dispatch so
      // the cockpit Start button and status are never misleading (event before view).
      db.updateMissionStatus(mission.id, 'running')
      db.updateOperatorSession(session.id, { status: 'running' })
      db.insertEvent('operator.run_starting', 'mission', mission.id, { sessionId: session.id })
      db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'Worker', sessionId: session.id })
      const runPromise = runOperatorMission(db, stateDir, session.id, mission.id)
      if (isTestRuntime()) {
        const result = await runPromise
        return { session: db.getOperatorSession(session.id), result, overview: buildMissionOverview(db, mission.id, stateDir) }
      }
      void runPromise.catch((e) => {
        // Cancellation fence: a Stop during the run must not be overwritten by a late failure.
        if (skipFinalWriteIfCancelled(db, mission.id, 'operator.start.catch')) {
          db.updateOperatorSession(session.id, { status: 'cancelled' })
          return
        }
        db.updateOperatorSession(session.id, { status: 'failed' })
        db.updateMissionStatus(mission.id, 'failed')
        db.insertEvent('operator.worker_failed', 'mission', mission.id, { sessionId: session.id, error: (e as Error).message })
      })
      return {
        session: db.getOperatorSession(session.id),
        result: { status: 'running', mergeDecision: 'WAITING' },
        overview: buildMissionOverview(db, mission.id, stateDir),
      }
    } catch (e) {
      db.updateOperatorSession(session.id, { status: 'failed' })
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/create-pr', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session?.missionId) return reply.code(404).send({ error: 'session or mission not found' })
    const mission = db.getMission(session.missionId)
    if (!mission) return reply.code(404).send({ error: 'mission not found' })
    const repo = db.getRepo(mission.repoId)
    if (!repo) return reply.code(404).send({ error: 'repo not found' })
    const approvals = db.listApprovals().filter((a) => a.entityId === mission.id && a.status === 'approved')
    const overview = buildMissionOverview(db, mission.id, stateDir)
    if (!overview?.evidenceDir) return reply.code(400).send({ error: 'mission has not reached evidence gate' })
    if (approvals.length === 0) return reply.code(400).send({ error: 'operator approval is required before draft PR creation' })
    const geminiGate = evaluateGeminiPrGate(overview.validators)
    if (!geminiGate.ok) {
      db.insertEvent('operator.draft_pr_blocked', 'mission', mission.id, { code: geminiGate.code, reason: geminiGate.reason, validator: 'gemini' })
      db.insertEvent('operator.gemini_pr_blocked', 'mission', mission.id, {
        code: geminiGate.code,
        reason: geminiGate.reason,
        verdict: geminiGate.result?.verdict ?? 'not_configured',
        summary: geminiGate.result?.summary ?? null,
      })
      db.insertOperatorMessage({
        sessionId: session.id,
        role: 'assistant',
        content: renderGeminiPrGateBubble(geminiGate),
        meta: { provider: 'gemini', authMode: 'validator-api-only', agentMode: 'single' },
      })
      compileTier2LessonsToTier1(repo, projectTier2Lessons(db, { repoId: repo.id }))
      return { status: 'blocked', code: geminiGate.code, reason: geminiGate.reason, overview: buildMissionOverview(db, mission.id, stateDir) }
    }
    const allowRemoteWrites = allowRemoteWritesEnabled(stateDir)
    const whitelist = remoteWriteWhitelist(stateDir)
    const executor = options.draftPrExecutor
    const prEvidence = readDraftPrEvidence(overview.evidenceDir)
    const request: DraftPrRequest = {
      repo,
      missionId: mission.id,
      title: mission.title,
      branch: prEvidence.branch ?? `operator/${mission.id.slice(0, 8)}`,
      base: repo.defaultBranch,
      changedPaths: prEvidence.changedPaths,
      evidenceUri: overview.evidenceDir,
      riskScore: 0,
      validatorResults: overview.validators,
      rollbackNotes: 'Close the draft PR; no merge was performed by Operator Cockpit.',
    }
    const executorRequest: DraftPrRequest = {
      ...request,
      repo: prEvidence.worktreePath ? { ...repo, path: prEvidence.worktreePath } : repo,
    }
    try {
      if (!allowRemoteWrites || !whitelist.includes(repo.name)) {
        await new DraftPrGate({ allowRemoteWrites, remoteWriteWhitelist: whitelist }, { pushBranch: async () => undefined }, { createDraftPr: async () => {
          throw new Error('unreachable')
        } }).openDraftPr(request)
      }
      if (!executor) {
        throw new DraftPrExecutorUnavailableError('remote-write executor is not configured for Operator Cockpit')
      }
      const info = await executor.openDraftPr(executorRequest)
      if (/example\.invalid/i.test(info.url)) {
        throw new DraftPrExecutorUnavailableError('remote-write executor returned a non-production PR URL')
      }
      db.updateMissionGitHub(mission.id, { githubBranch: request.branch, githubPrUrl: info.url, githubPrNumber: info.number })
      db.insertEvent('operator.draft_pr_created', 'mission', mission.id, { url: info.url, number: info.number })
      if (db.resolveHold(mission.id, 'HOLD-DRAFT-PR-EXECUTOR') > 0) {
        db.insertEvent('operator.hold_resolved', 'mission', mission.id, { code: 'HOLD-DRAFT-PR-EXECUTOR' })
      }
      return { status: 'created', pr: info, overview: buildMissionOverview(db, mission.id, stateDir) }
    } catch (e) {
      const code = e instanceof DraftPrGateError ? e.code : e instanceof DraftPrExecutorUnavailableError ? 'DRAFT_PR_EXECUTOR_UNAVAILABLE' : 'DRAFT_PR_BLOCKED'
      const reason = (e as Error).message
      db.insertEvent('operator.draft_pr_blocked', 'mission', mission.id, { code, reason })
      if (code === 'DRAFT_PR_EXECUTOR_UNAVAILABLE') {
        db.insertEvent('operator.hold_created', 'mission', mission.id, {
          holdCode: 'HOLD-DRAFT-PR-EXECUTOR',
          reason,
          nextAction: 'Configure a worker/side-effect remote-write executor; daemon-owned fake PR adapters are disabled.',
        })
        db.insertHold({ entityType: 'mission', entityId: mission.id, code: 'HOLD-DRAFT-PR-EXECUTOR', reason, nextAction: 'Configure a worker/side-effect remote-write executor; daemon-owned fake PR adapters are disabled.' })
      }
      return { status: 'blocked', code, reason, overview: buildMissionOverview(db, mission.id, stateDir) }
    }
  })

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/pause', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session?.missionId) return reply.code(404).send({ error: 'session or mission not found' })
    const mission = db.getMission(session.missionId)
    if (!mission) return reply.code(404).send({ error: 'mission not found' })
    db.updateOperatorSession(session.id, { status: 'paused' })
    db.updateMissionStatus(mission.id, 'paused')
    db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'PR/Waiting/Blocked', sessionId: session.id, status: 'paused' })
    return { session: db.getOperatorSession(session.id), overview: buildMissionOverview(db, mission.id, stateDir) }
  })

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/resume', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session?.missionId) return reply.code(404).send({ error: 'session or mission not found' })
    const mission = db.getMission(session.missionId)
    if (!mission) return reply.code(404).send({ error: 'mission not found' })
    db.updateOperatorSession(session.id, { status: 'approved' })
    db.updateMissionStatus(mission.id, 'approved')
    db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'Approved', sessionId: session.id, status: 'approved' })
    return { session: db.getOperatorSession(session.id), overview: buildMissionOverview(db, mission.id, stateDir) }
  })

  // Stop = operator cancel. Flips mission + session to `cancelled` immediately; the
  // cancellation fence (cancellation.ts) then prevents the detached worker from
  // overwriting this state when it later finishes/times out. This is a write fence,
  // NOT a subprocess kill — the worker CLI is spawned inside the runner with no PID
  // surfaced to this layer, so a true hard-kill is a documented engine follow-up.
  app.post<{ Params: { id: string } }>('/operator/sessions/:id/stop', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session?.missionId) return reply.code(404).send({ error: 'session or mission not found' })
    const mission = db.getMission(session.missionId)
    if (!mission) return reply.code(404).send({ error: 'mission not found' })
    db.updateMissionStatus(mission.id, 'cancelled')
    db.updateOperatorSession(session.id, { status: 'cancelled' })
    db.insertEvent('operator.cancel_requested', 'mission', mission.id, {
      sessionId: session.id,
      note: 'Operator pressed Stop. Mission/session marked cancelled; any in-flight worker result is fenced and ignored. Subprocess kill is not available at this layer.',
    })
    db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'PR/Waiting/Blocked', sessionId: session.id, status: 'cancelled' })
    return { session: db.getOperatorSession(session.id), overview: buildMissionOverview(db, mission.id, stateDir) }
  })

  app.get<{ Params: { id: string } }>('/missions/:id/overview', async (req, reply) => {
    const overview = buildMissionOverview(db, req.params.id, stateDir)
    if (!overview) return reply.code(404).send({ error: 'mission not found' })
    return overview
  })

  app.get<{ Params: { id: string; runId: string } }>('/missions/:id/runs/:runId/log', async (req, reply) => {
    const overview = buildMissionOverview(db, req.params.id, stateDir)
    if (!overview) return reply.code(404).send({ error: 'mission not found' })
    const run = overview.runs.find((r) => r.id === req.params.runId)
    if (!run) return reply.code(404).send({ error: 'run not found' })
    const logPath = run.evidenceDir ? join(run.evidenceDir, 'operator-run.log') : ''
    return { text: logPath && existsSync(logPath) ? readFileSync(logPath, 'utf8') : '', logPath }
  })
}

function brainstormChoices(): OperatorChoice[] {
  return [
    { id: 'generate-roadmap', label: '方向 OK，生成 PRD', labelEn: 'Direction OK — generate PRD', action: 'generate-roadmap' },
    {
      id: 'ask-questions',
      label: '继续问到足够清楚',
      labelEn: 'Ask until clear enough',
      action: 'ask-questions',
      prompt: '请先不要执行。请提出你还需要确认的问题，直到你对需求达到至少 95% 的自信度。',
    },
    { id: 'add-constraints', label: '补充约束', labelEn: 'Add constraints', action: 'add-constraints' },
  ]
}

function toOperatorQuestion(q: ClarificationQuestion): OperatorQuestion {
  const destination = ({
    'acceptance-criteria': 'PRD acceptance criteria + validator contract',
    target: 'Roadmap scope + worker prompt target surface',
    scope: 'ADR tradeoffs + task DAG boundaries',
    'done-definition': 'Evidence checklist + final worker done report',
  } as Record<string, string>)[q.field] ?? 'PRD/Roadmap planning input'
  return {
    id: q.id,
    field: q.field,
    question: q.question,
    why: `This resolves the ${q.field.replace(/-/g, ' ')} before any worker runs.`,
    impact: 'It changes the plan shape, acceptance checks, and what the worker is allowed to touch.',
    destination,
    options: q.choices.map((c) => ({
      label: c.label,
      ...(c.value ? { value: c.value } : {}),
      ...(c.label === q.recommendedDefault ? { recommended: true } : {}),
    })),
  }
}

/**
 * Build structured clarification questions for a session (PRD §B). Reuses the
 * deterministic ClarificationGate generator. `fields` forces a specific set
 * (used by the explicit "ask me 3 questions" follow-up); otherwise questions
 * are derived from the prompt's ambiguity.
 */
function operatorQuestionsFor(db: AedevDb, stateDir: string, title: string, prompt: string, fields?: ClarificationField[]): OperatorQuestion[] {
  const gate = new ClarificationGate(db, stateDir)
  const ambiguity = fields
    ? { score: 100, reasons: [], missing: fields }
    : scoreAmbiguity({ title, description: prompt }, null)
  return gate.generateQuestions(ambiguity).map(toOperatorQuestion)
}

function answeredQuestionIds(db: AedevDb, sessionId: string): Set<string> {
  const ids = new Set<string>()
  for (const e of db.queryEvents({ type: 'operator.questions_answered', entityId: sessionId, limit: 200 })) {
    const answers = e.payload['answers']
    if (!Array.isArray(answers)) continue
    for (const answer of answers as Array<Record<string, unknown>>) {
      if (typeof answer['questionId'] === 'string') ids.add(answer['questionId'])
    }
  }
  return ids
}

function latestPendingQuestions(db: AedevDb, sessionId?: string): OperatorQuestion[] {
  if (!sessionId) return []
  const questions = latestPlannerQuestions(db, sessionId)
  if (questions.length === 0) return []
  const answered = answeredQuestionIds(db, sessionId)
  return questions.filter((q) => !answered.has(q.id))
}

function latestClarifyConfidence(db: AedevDb, sessionId?: string): { confidence?: number; rationale?: string } {
  if (!sessionId) return {}
  const event = db.queryEvents({ type: 'clarify.confidence', entityId: sessionId, limit: 1 })[0]
  const confidence = typeof event?.payload['confidence'] === 'number'
    ? Math.max(0, Math.min(100, event.payload['confidence'] as number))
    : undefined
  const rationale = typeof event?.payload['rationale'] === 'string' ? event.payload['rationale'] as string : undefined
  return { ...(confidence !== undefined ? { confidence } : {}), ...(rationale ? { rationale } : {}) }
}

function evaluateClarifyGate(db: AedevDb, sessionId: string): ClarifyGateState {
  const pendingQuestions = latestPendingQuestions(db, sessionId)
  const roundsCompleted = db.queryEvents({ type: 'operator.questions_answered', entityId: sessionId, limit: 200 }).length
  const { confidence, rationale } = latestClarifyConfidence(db, sessionId)
  const effectiveConfidence = confidence ?? 0
  const unlocked = effectiveConfidence >= 95 && pendingQuestions.length === 0
  const reason = pendingQuestions.length > 0
    ? `${pendingQuestions.length} clarification question(s) still need answers.`
    : effectiveConfidence < 95
      ? `Planner confidence is ${effectiveConfidence}%, below the 95% threshold.`
      : 'Planner confidence is at least 95% and no clarification questions are pending.'
  return { unlocked, confidence: effectiveConfidence, pendingQuestions, roundsCompleted, reason, ...(rationale ? { rationale } : {}) }
}

function recordClarifyRound(
  db: AedevDb,
  sessionId: string,
  role: string,
  parsed: ParsedClarification,
  questions: OperatorQuestion[],
): ClarifyGateState {
  const confidence = parsed.confidence ?? (questions.length > 0 ? 60 : 96)
  const rationale = parsed.rationale ?? (questions.length > 0
    ? 'Planner needs operator answers before this is safe to plan.'
    : 'Planner found the request specific enough to draft a roadmap.')
  db.insertEvent('clarify.round', 'operator_session', sessionId, {
    role,
    questionCount: questions.length,
    questionIds: questions.map((q) => q.id),
    confidence,
    rationale,
  })
  db.insertEvent('clarify.confidence', 'operator_session', sessionId, {
    role,
    confidence,
    threshold: 95,
    rationale,
  })
  const state = evaluateClarifyGate(db, sessionId)
  if (state.unlocked && db.queryEvents({ type: 'clarify.unlocked', entityId: sessionId, limit: 1 }).length === 0) {
    db.insertEvent('clarify.unlocked', 'operator_session', sessionId, {
      confidence: state.confidence,
      threshold: 95,
      roundsCompleted: state.roundsCompleted,
      rationale: state.rationale,
    })
  }
  return state
}

function renderClarifyBlockedMessage(state: ClarifyGateState): string {
  return [
    'CLARIFY-GATE-BLOCKED: planning/execution is locked until understanding reaches 95%.',
    '',
    `Confidence: ${state.confidence}% / 95%`,
    `Pending questions: ${state.pendingQuestions.length}`,
    '',
    state.reason,
    ...(state.rationale ? ['', `Planner rationale: ${state.rationale}`] : []),
    '',
    'Answer the pending questions or ask the planner for another clarification round.',
  ].join('\n')
}

function blockForClarifyGate(db: AedevDb, sessionId: string, action: 'generate-roadmap' | 'start'): { blocked: true; state: ClarifyGateState; message: string } | { blocked: false; state: ClarifyGateState } {
  const state = evaluateClarifyGate(db, sessionId)
  if (state.unlocked) return { blocked: false, state }
  const message = renderClarifyBlockedMessage(state)
  db.insertEvent('clarify.blocked', 'operator_session', sessionId, {
    action,
    confidence: state.confidence,
    threshold: 95,
    pendingQuestionIds: state.pendingQuestions.map((q) => q.id),
    reason: state.reason,
  })
  return { blocked: true, state, message }
}

function allowTemplateClarifications(): boolean {
  return isTestRuntime() || isTemplateRoadmapEnabled()
}

function renderClarificationStructureHold(provider: string, originalContent: string): string {
  return [
    'HOLD-CLARIFY-STRUCTURE: planner returned prose but no structured clickable clarification questions.',
    '',
    `Provider: ${provider}`,
    '',
    'No preset/template questions were substituted in real mode. Retry the brainstorm or ask Claude to continue clarifying until it has enough goal-specific context.',
    '',
    'Planner prose kept for context:',
    '',
    originalContent,
  ].join('\n')
}

/**
 * Parse the planner's own clarifying questions from a fenced ```json block (P3 —
 * adaptive clarify). The planner is prompted to emit goal-specific questions as
 * JSON; we use those instead of the deterministic template bank, falling back to
 * the template only when the LLM produced none. Returns the structured questions
 * plus the content with the JSON block stripped (so the chat shows prose, not raw
 * JSON). Exported for unit testing.
 */
export function parseClarifyQuestions(content: string): ParsedClarification {
  const fence = content.match(/```json\s*([\s\S]*?)```/i)
  const raw = fence?.[1]?.trim()
  if (!raw) return { questions: [], cleaned: content }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { questions: [], cleaned: content }
  }
  const parsedObj = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed as Record<string, unknown>
    : undefined
  const items = Array.isArray(parsed)
    ? parsed
    : Array.isArray(parsedObj?.['questions'])
      ? parsedObj['questions'] as unknown[]
      : undefined
  if (!items) return { questions: [], cleaned: content }
  const questions: OperatorQuestion[] = []
  for (const item of items.slice(0, 4)) {
    if (!item || typeof item !== 'object') continue
    const q = item as { question?: unknown; options?: unknown }
    const question = typeof q.question === 'string' ? q.question.trim() : ''
    const field = typeof (item as { field?: unknown }).field === 'string'
      ? String((item as { field?: unknown }).field).trim()
      : 'clarify'
    const why = typeof (item as { why?: unknown }).why === 'string'
      ? String((item as { why?: unknown }).why).trim()
      : 'The planner needs this answer to avoid optimizing for the wrong objective.'
    const impact = typeof (item as { impact?: unknown }).impact === 'string'
      ? String((item as { impact?: unknown }).impact).trim()
      : 'This affects scope, acceptance criteria, and the worker prompt.'
    const destination = typeof (item as { destination?: unknown }).destination === 'string'
      ? String((item as { destination?: unknown }).destination).trim()
      : 'PRD/Roadmap'
    const options = (Array.isArray(q.options) ? q.options : [])
      .map((o) => {
        const oo = (o ?? {}) as { label?: unknown; recommended?: unknown }
        const label = typeof oo.label === 'string' ? oo.label.trim() : ''
        return label ? { label, ...(oo.recommended === true ? { recommended: true as const } : {}) } : null
      })
      .filter((o): o is { label: string; recommended?: true } => o !== null)
    if (question && options.length >= 2) {
      questions.push({ id: `clq-${generateId()}`, field, question, why, impact, destination, options })
    }
  }
  const cleaned = content.replace(/```json\s*[\s\S]*?```/i, '').trim()
  const confidenceRaw = parsedObj?.['confidence']
  const confidence = typeof confidenceRaw === 'number'
    ? Math.max(0, Math.min(100, confidenceRaw))
    : typeof confidenceRaw === 'string' && confidenceRaw.trim()
      ? Math.max(0, Math.min(100, Number(confidenceRaw)))
      : undefined
  const rationale = typeof parsedObj?.['rationale'] === 'string'
    ? parsedObj['rationale'].trim()
    : undefined
  return {
    questions,
    cleaned,
    ...(Number.isFinite(confidence) ? { confidence } : {}),
    ...(rationale ? { rationale } : {}),
  }
}

function providerAuthMode(provider?: string): string {
  if (provider && /-api$|^gemini-api$|^openai-api$/.test(provider)) return 'api'
  return 'subscription'
}

/** Provider transparency for a "thinking" placeholder — shown before token usage
 *  is known (the footer renders "tokens pending"). PRD §C/AC1: transparency must
 *  be visible during thinking, not only on completion. */
function thinkingMeta(): OperatorMessageMeta {
  const provider = process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'claude'
  return { provider, authMode: providerAuthMode(provider), agentMode: 'single' }
}

/** Provider/token transparency for an assistant turn, from a role_done event payload. */
function messageMeta(event: Record<string, unknown>): OperatorMessageMeta | undefined {
  const provider = typeof event['provider'] === 'string' ? (event['provider'] as string) : undefined
  if (!provider && typeof event['inputTokens'] !== 'number' && typeof event['outputTokens'] !== 'number') return undefined
  return {
    ...(provider ? { provider } : {}),
    authMode: providerAuthMode(provider),
    agentMode: 'single',
    ...(typeof event['inputTokens'] === 'number' ? { inputTokens: event['inputTokens'] as number } : {}),
    ...(typeof event['outputTokens'] === 'number' ? { outputTokens: event['outputTokens'] as number } : {}),
    ...(event['costUsd'] !== undefined ? { costUsd: event['costUsd'] as number | null } : {}),
  }
}

function renderBrainstorm(prompt: string): string {
  return [
    'Initial brainstorm:',
    '- Clarify the operator goal and repo target.',
    '- Generate PRD, ADR draft, roadmap, task DAG, and acceptance checks before execution.',
    '- Execute only after roadmap approval, then stop at draft PR/evidence gate unless merge policy allows more.',
    '',
    `Working prompt: ${prompt}`,
  ].join('\n')
}

function syntheticClarifyBlock(title: string, prompt: string, fields?: ClarificationField[]): string {
  const missing = fields ?? scoreAmbiguity({ title, description: prompt }, null).missing
  const needsQuestions = missing.length > 0 && /improve|better|polish|everything|whole|stuff|thing|unclear|vague/i.test(`${title}\n${prompt}`)
  const selected = (needsQuestions ? missing : []).slice(0, 4)
  const questions = selected.map((field) => syntheticQuestion(field))
  return [
    '```json',
    JSON.stringify({
      questions,
      confidence: questions.length ? 60 : 96,
      rationale: questions.length
        ? 'Synthetic planner found the request ambiguous enough to need operator answers.'
        : 'Synthetic planner found the request specific enough for a roadmap.',
    }, null, 2),
    '```',
  ].join('\n')
}

function syntheticQuestion(field: ClarificationField): Omit<OperatorQuestion, 'id'> {
  const base = ({
    'acceptance-criteria': {
      question: 'What is the most important observable acceptance criterion?',
      options: [{ label: 'A specific command or test must pass', recommended: true }, { label: 'A named UI behavior must change' }],
    },
    target: {
      question: 'Which concrete file, component, or command is the target?',
      options: [{ label: 'A named source file/module', recommended: true }, { label: 'Docs or README only' }],
    },
    scope: {
      question: 'How tightly should this mission be scoped?',
      options: [{ label: 'Smallest viable change', recommended: true }, { label: 'A broader multi-file pass' }],
    },
    'done-definition': {
      question: 'What makes this mission done beyond "it works"?',
      options: [{ label: 'Tests pass and evidence is written', recommended: true }, { label: 'A reviewable artifact is produced' }],
    },
  } as Record<ClarificationField, { question: string; options: Array<{ label: string; recommended?: true }> }>)[field]
  return {
    field,
    question: base.question,
    why: `This resolves ${field.replace(/-/g, ' ')} before planning.`,
    impact: 'It changes the roadmap, worker prompt, and validation checklist.',
    destination: 'PRD/Roadmap',
    options: base.options,
  }
}

async function completePlannerBrainstorm(
  db: AedevDb,
  stateDir: string,
  sessionId: string,
  prompt: string,
  title: string,
  repoId: string,
): Promise<void> {
  try {
    db.insertEvent('operator.role_started', 'operator_session', sessionId, { role: 'planner', provider: process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'claude' })
    const brainstorm = await runPlannerBrainstorm(prompt, title, repoId, { db, sessionId })
    const isHold = Boolean(brainstorm.event['holdCode'])
    // Prefer the planner's own goal-specific questions (parsed from its JSON block);
    // fall back to the deterministic template only when the LLM produced none (P3).
    const parsed = isHold ? { questions: [], cleaned: brainstorm.content } : parseClarifyQuestions(brainstorm.content)
    const missingStructuredQuestions = !isHold && parsed.questions.length === 0 && parsed.confidence === undefined && !allowTemplateClarifications()
    const questions = isHold
      ? []
      : parsed.questions.length
        ? parsed.questions
        : parsed.confidence === undefined && allowTemplateClarifications()
          ? operatorQuestionsFor(db, stateDir, title, prompt)
          : []
    const expectedConfidence = parsed.confidence ?? (questions.length > 0 ? 60 : 96)
    const choices = expectedConfidence >= 95 && questions.length === 0
      ? brainstormChoices()
      : brainstormChoices().filter((c) => c.action !== 'generate-roadmap')
    const meta = messageMeta(brainstorm.event)
    db.insertOperatorMessage({
      sessionId,
      role: 'assistant',
      content: missingStructuredQuestions
        ? renderClarificationStructureHold(String(brainstorm.event['provider'] ?? 'planner'), brainstorm.content)
        : parsed.cleaned,
      ...(isHold || missingStructuredQuestions ? {} : { choices }),
      ...(questions.length ? { questions } : {}),
      ...(meta ? { meta } : {}),
    })
    const gateState = isHold || missingStructuredQuestions
      ? undefined
      : recordClarifyRound(db, sessionId, 'planner', parsed, questions)
    db.updateOperatorSession(sessionId, { status: isHold || missingStructuredQuestions ? 'hold' : gateState?.unlocked ? 'brainstorm_ready' : 'clarifying' })
    if (missingStructuredQuestions) {
      db.insertEvent('operator.hold_created', 'operator_session', sessionId, {
        holdCode: 'HOLD-CLARIFY-STRUCTURE',
        reason: 'Planner did not return structured JSON clarification questions; preset fallback is disabled in real mode.',
      })
      db.insertHold({
        entityType: 'operator_session',
        entityId: sessionId,
        code: 'HOLD-CLARIFY-STRUCTURE',
        reason: 'Planner did not return structured JSON clarification questions; preset fallback is disabled in real mode.',
        nextAction: 'Retry Brainstorm or ask Claude to continue clarifying; the planner must return a fenced JSON question block.',
      })
    }
    if (!isHold && !missingStructuredQuestions && gateState?.unlocked) resolveSessionHolds(db, sessionId)
    db.insertEvent('operator.role_done', 'operator_session', sessionId, brainstorm.event)
    if (typeof brainstorm.event['inputTokens'] === 'number' || typeof brainstorm.event['outputTokens'] === 'number') {
      db.insertEvent('operator.cost_updated', 'operator_session', sessionId, {
        scope: 'planner_brainstorm',
        provider: brainstorm.event['provider'],
        authMode: brainstorm.event['authMode'],
        inputTokens: brainstorm.event['inputTokens'] ?? 0,
        outputTokens: brainstorm.event['outputTokens'] ?? 0,
        costUsd: brainstorm.event['costUsd'] ?? null,
      })
    }
  } catch (e) {
    db.insertOperatorMessage({
      sessionId,
      role: 'assistant',
      content: renderPlannerHold('local planner', (e as Error).message, prompt),
    })
    db.updateOperatorSession(sessionId, { status: 'hold' })
    db.insertEvent('operator.hold_created', 'operator_session', sessionId, {
      holdCode: 'HOLD-PLANNER-CLI',
      reason: (e as Error).message,
    })
    db.insertHold({ entityType: 'operator_session', entityId: sessionId, code: 'HOLD-PLANNER-CLI', reason: (e as Error).message })
  }
}

/** Resolve any active session HOLDs and announce it so the UI clears stale banners (PRD §D). */
function resolveSessionHolds(db: AedevDb, sessionId: string, code?: string): void {
  const resolved = db.resolveHold(sessionId, code)
  if (resolved > 0) db.insertEvent('operator.hold_resolved', 'operator_session', sessionId, { resolved, ...(code ? { code } : {}) })
}

/** Budget attribution context for headless planner calls (P1). */
interface HeadlessBudgetCtx { db: AedevDb; sessionId: string }

async function runPlannerBrainstorm(prompt: string, title: string, repoId: string, budget?: HeadlessBudgetCtx): Promise<{ content: string; event: Record<string, unknown> }> {
  const textFixture = process.env['AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT']
  if (textFixture) {
    return { content: textFixture, event: { role: 'planner', provider: 'fixture', authMode: 'test', repoId, inputTokens: 0, outputTokens: 0, costUsd: null } }
  }
  if (isTestRuntime() || isTemplateRoadmapEnabled()) {
    return {
      content: [renderBrainstorm(prompt), '', syntheticClarifyBlock(title, prompt)].join('\n'),
      event: { role: 'planner', provider: 'test-synthetic', repoId },
    }
  }

  const systemPrompt = [
    'You are the Claude Code 24/7 lead planner and product copilot.',
    'Produce concrete brainstorm options, risks, a recommended roadmap, approval questions, and observable execution checkpoints.',
    'Ask only the clarifying questions you truly need before execution; the number may be zero, one, or many.',
    'Be concise but specific. Write bilingual headings in Chinese + English when the user writes Chinese.',
  ].join(' ')
  const plannerPrompt = [
    `Mission title: ${title}`,
    `Repo id: ${repoId}`,
    '',
    'User request:',
    prompt,
    '',
    'Return markdown with sections: Brainstorm, Operator Questions, Proposed PRD, ADR Questions, Roadmap, Approval Criteria, Execution Monitoring.',
    'At the very end, append one fenced ```json code block with this exact object shape: {"questions": [{"field": string, "question": string, "why": string, "impact": string, "destination": string, "options": [{"label": string, "recommended": boolean}]}], "confidence": number, "rationale": string}. Use confidence 0-100 for how ready the system is to generate a roadmap. If confidence is below 95, include the concrete goal-specific questions still needed. If confidence is 95 or above, questions must be an empty array.',
    'Do not claim code was changed. This is planning only.',
  ].join('\n')
  return runLocalPlannerText(systemPrompt, plannerPrompt, 'planner', prompt, budget)
}

async function runPlannerFollowup(requestPrompt: string, title: string, repoId: string, originalPrompt: string, clarifications: string, budget?: HeadlessBudgetCtx): Promise<{ content: string; event: Record<string, unknown> }> {
  const textFixture = process.env['AEDEV_COCKPIT_PLANNER_FOLLOWUP_FIXTURE_TEXT']
  if (textFixture) {
    return { content: textFixture, event: { role: 'planner-followup', provider: 'fixture', authMode: 'test', repoId, inputTokens: 0, outputTokens: 0, costUsd: null } }
  }
  if (isTestRuntime() || isTemplateRoadmapEnabled()) {
    return {
      content: [renderFollowupQuestions(originalPrompt), '', syntheticClarifyBlock(title, originalPrompt, ['acceptance-criteria', 'target', 'scope'])].join('\n'),
      event: { role: 'planner-followup', provider: 'test-synthetic', repoId },
    }
  }

  const systemPrompt = [
    'You are the Claude Code 24/7 lead planner.',
    'Your job is to decide whether the operator answers are now sufficient to plan safely.',
    'Ask only the remaining clarifying questions that are truly needed to reach at least 95% confidence. Do not ask filler questions.',
    'Do not generate a roadmap yet and do not claim any code changed. Write bilingual (Chinese + English) when the user writes Chinese.',
  ].join(' ')
  const plannerPrompt = [
    `Mission title: ${title}`,
    `Repo id: ${repoId}`,
    '',
    'Original request:',
    originalPrompt,
    '',
    'Operator clarification transcript so far:',
    clarifications || '(none yet)',
    '',
    'Operator follow-up request:',
    requestPrompt,
    '',
    'Return an "Operator Questions" section only when more information is truly needed. Planning only.',
    'Also append one fenced ```json code block with this exact object shape: {"questions": [{"field": string, "question": string, "why": string, "impact": string, "destination": string, "options": [{"label": string, "recommended": boolean}]}], "confidence": number, "rationale": string}. Use confidence 0-100 for how ready the system is to generate a roadmap. Below 95 must include the concrete remaining questions. At 95 or above, return "questions": [] and explain why the answers are sufficient.',
  ].join('\n')
  return runLocalPlannerText(systemPrompt, plannerPrompt, 'planner-followup', requestPrompt, budget)
}

async function runLocalPlannerText(systemPrompt: string, plannerPrompt: string, role: string, holdContextPrompt: string, budget?: HeadlessBudgetCtx): Promise<{ content: string; event: Record<string, unknown> }> {
  const timeoutMs = Number(process.env['AEDEV_COCKPIT_AI_TIMEOUT_MS'] ?? '300000')
  const failures: string[] = []
  const plannerProvider = process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'claude'

  // P1 credit guard: every headless claude call is metered Agent SDK credit.
  if (budget) {
    const verdict = checkHeadlessBudget(budget.db, budget.sessionId)
    if (!verdict.allowed) {
      const reason = createBudgetHold(budget.db, budget.sessionId, verdict)
      return {
        content: renderPlannerHold('headless budget guard', reason, holdContextPrompt),
        event: { role, provider: null, holdCode: HOLD_BUDGET_CODE, reason },
      }
    }
  }

  const claude = new ClaudeCodeAdapter()
  if (plannerProvider === 'claude' && await claude.isAvailable()) {
    const result = await claude.run(plannerPrompt, process.cwd(), {
      systemPrompt,
      permissionMode: 'bypassPermissions',
      timeoutMs,
    })
    if (budget) {
      recordHeadlessCall(budget.db, budget.sessionId, {
        role,
        provider: 'claude-cli',
        authMode: result.authMode,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        exitCode: result.exitCode,
      })
    }
    if (result.exitCode === 0 && result.transcript.trim()) {
      return {
        content: result.transcript.trim(),
        event: {
          role,
          provider: 'claude-cli',
          authMode: result.authMode,
          inputTokens: result.inputTokens,
          outputTokens: result.outputTokens,
          costUsd: result.costUsd,
        },
      }
    }
    failures.push(`claude-cli: ${result.error ?? `exit ${result.exitCode}`}`)
  }

  if (plannerProvider !== 'claude') {
    failures.push(`unsupported planner provider '${plannerProvider}'; P1 requires claude-cli`)
  }

  return {
    content: renderPlannerHold('claude-cli planner', failures.length ? failures.join('; ') : 'No healthy Claude CLI was found on PATH.', holdContextPrompt),
    event: { role, provider: null, holdCode: failures.length ? 'HOLD-PLANNER-CLI' : 'HOLD-NO-LOCAL-CLI', failures },
  }
}

function renderFollowupQuestions(prompt: string): string {
  return [
    'Operator Questions · 需要你确认的问题：',
    '',
    '1. 范围 Scope：这次只做最小可行改动，还是包含相邻清理？（推荐 Recommended：仅最小改动）',
    '2. 风险 Risk：是否允许改动依赖、配置或迁移？（推荐 Recommended：不允许，保持低风险）',
    '3. 验收 Acceptance：用什么命令判定成功？（推荐 Recommended：pnpm typecheck + 针对性测试）',
    '',
    `基于你的目标 · Based on your goal: ${prompt}`,
    '',
    '回答后选择下面的下一步 · Answer above, then pick a next step below.',
  ].join('\n')
}

async function completePlannerFollowup(
  db: AedevDb,
  stateDir: string,
  sessionId: string,
  requestPrompt: string,
  title: string,
  repoId: string,
  originalPrompt: string,
): Promise<void> {
  try {
    db.insertEvent('operator.role_started', 'operator_session', sessionId, { role: 'planner-followup', provider: process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'claude' })
    const followup = await runPlannerFollowup(requestPrompt, title, repoId, originalPrompt, buildClarifications(db, sessionId), { db, sessionId })
    const isHold = Boolean(followup.event['holdCode'])
    // Prefer the planner's own goal-specific questions; fall back to the template
    // 3-question set ('ask me 3 questions') only when the LLM produced none (P3).
    const parsed = isHold ? { questions: [], cleaned: followup.content } : parseClarifyQuestions(followup.content)
    const missingStructuredQuestions = !isHold && parsed.questions.length === 0 && parsed.confidence === undefined && !allowTemplateClarifications()
    const questions = isHold
      ? []
      : parsed.questions.length
        ? parsed.questions
        : parsed.confidence === undefined && allowTemplateClarifications()
          ? operatorQuestionsFor(db, stateDir, title, originalPrompt, ['acceptance-criteria', 'target', 'scope'])
          : []
    const expectedConfidence = parsed.confidence ?? (questions.length > 0 ? 60 : 96)
    const choices = expectedConfidence >= 95 && questions.length === 0
      ? brainstormChoices()
      : brainstormChoices().filter((c) => c.action !== 'generate-roadmap')
    const meta = messageMeta(followup.event)
    db.insertOperatorMessage({
      sessionId,
      role: 'assistant',
      content: missingStructuredQuestions
        ? renderClarificationStructureHold(String(followup.event['provider'] ?? 'planner-followup'), followup.content)
        : parsed.cleaned,
      ...(isHold || missingStructuredQuestions ? {} : { choices }),
      ...(questions.length ? { questions } : {}),
      ...(meta ? { meta } : {}),
    })
    const gateState = isHold || missingStructuredQuestions
      ? undefined
      : recordClarifyRound(db, sessionId, 'planner-followup', parsed, questions)
    db.updateOperatorSession(sessionId, { status: isHold || missingStructuredQuestions ? 'hold' : gateState?.unlocked ? 'brainstorm_ready' : 'clarifying' })
    if (missingStructuredQuestions) {
      db.insertEvent('operator.hold_created', 'operator_session', sessionId, {
        holdCode: 'HOLD-CLARIFY-STRUCTURE',
        reason: 'Planner did not return structured JSON clarification questions; preset fallback is disabled in real mode.',
      })
      db.insertHold({
        entityType: 'operator_session',
        entityId: sessionId,
        code: 'HOLD-CLARIFY-STRUCTURE',
        reason: 'Planner did not return structured JSON clarification questions; preset fallback is disabled in real mode.',
        nextAction: 'Ask Claude to continue clarifying; the planner must return a fenced JSON question block.',
      })
    }
    if (!isHold && !missingStructuredQuestions && gateState?.unlocked) resolveSessionHolds(db, sessionId)
    db.insertEvent('operator.role_done', 'operator_session', sessionId, followup.event)
    if (typeof followup.event['inputTokens'] === 'number' || typeof followup.event['outputTokens'] === 'number') {
      db.insertEvent('operator.cost_updated', 'operator_session', sessionId, {
        scope: 'planner_followup',
        provider: followup.event['provider'],
        authMode: followup.event['authMode'],
        inputTokens: followup.event['inputTokens'] ?? 0,
        outputTokens: followup.event['outputTokens'] ?? 0,
        costUsd: followup.event['costUsd'] ?? null,
      })
    }
  } catch (e) {
    db.insertOperatorMessage({
      sessionId,
      role: 'assistant',
      content: renderPlannerHold('local planner', (e as Error).message, requestPrompt),
    })
    db.updateOperatorSession(sessionId, { status: 'hold' })
    db.insertEvent('operator.hold_created', 'operator_session', sessionId, {
      holdCode: 'HOLD-PLANNER-CLI',
      reason: (e as Error).message,
    })
    db.insertHold({ entityType: 'operator_session', entityId: sessionId, code: 'HOLD-PLANNER-CLI', reason: (e as Error).message })
  }
}

function renderPlannerHold(provider: string, reason: string, prompt: string): string {
  return [
    `HOLD-PLANNER-CLI: ${provider} could not produce a real brainstorm.`,
    '',
    `Reason: ${reason}`,
    '',
    'No synthetic brainstorm was substituted. Fix the local CLI/session and click New Brainstorm again.',
    '',
    `Original prompt: ${prompt}`,
  ].join('\n')
}

function ensureOperatorRepo(db: AedevDb, requestedRepoId?: string): string {
  if (requestedRepoId && requestedRepoId !== 'unknown' && db.getRepo(requestedRepoId)) return requestedRepoId
  const existing = db.listRepos()[0]
  if (existing) return existing.id
  // Under the test runtime the fallback repo gets a throwaway git repo:
  // with path=cwd, mission flows that compile Tier-1 memory (Gemini block)
  // would write into the daemon's own working tree and dirty it.
  const fallbackPath = isTestRuntime() ? createThrowawayWorkspace() : process.cwd()
  return db.insertRepo({
    name: 'local-workspace',
    path: fallbackPath,
    defaultBranch: 'main',
    enabled: true,
    testCommands: [],
    forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    riskRules: {},
    mergePolicy: 'WAITING',
  }).id
}

/** Test-runtime fallback workspace: a tiny real git repo (validateTargetRepo
 *  requires commits) in tmp, so test missions never touch the daemon's own
 *  working tree. Falls back to cwd if git is unavailable. */
function createThrowawayWorkspace(): string {
  const dir = mkdtempSync(join(tmpdir(), 'aedev-local-workspace-'))
  try {
    execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: dir, stdio: 'ignore' })
    execFileSync('git', [
      '-c', 'user.email=test@aedev.invalid', '-c', 'user.name=aedev-test', '-c', 'commit.gpgsign=false',
      'commit', '--allow-empty', '-q', '-m', 'init',
    ], { cwd: dir, stdio: 'ignore' })
    return dir
  } catch {
    return process.cwd()
  }
}

async function generateRoadmapDesign(
  db: AedevDb,
  stateDir: string,
  intake: IntakeService,
  repoId: string,
  session: { id: string; title: string; prompt: string },
): Promise<{ ok: true; mission: NonNullable<ReturnType<AedevDb['getMission']>>; design: MissionDesign } | { ok: false; reason: string; message: string }> {
  if (isTemplateRoadmapEnabled()) {
    const mission = intake.createMissionCandidate(repoId, session.prompt, session.title)
    registerDesignArtifacts(db, stateDir, mission.id)
    return { ok: true, mission, design: intake.getDesign(mission.id)! }
  }

  const mission = db.insertMission({
    repoId,
    title: session.title,
    description: session.prompt,
    status: 'draft',
  })

  const output = await runPlannerMissionDesign(session.prompt, session.title, repoId, mission.id, buildClarifications(db, session.id), { db, sessionId: session.id })
  if (!output.ok) {
    return {
      ok: false,
      reason: output.reason,
      message: [
        'HOLD-ROADMAP-PLANNER: local planner CLI could not produce a valid PRD/ADR/Roadmap design.',
        '',
        `Reason: ${output.reason}`,
        '',
        'No deterministic template was substituted. Fix the planner CLI/session or set AEDEV_COCKPIT_FORCE_TEMPLATE=1 for explicit test fallback.',
      ].join('\n'),
    }
  }

  try {
    const design = validateMissionDesign(output.design)
    writeDesignArtifacts(db, stateDir, mission.id, design)
    db.insertEvent('operator.artifact_written', 'mission', mission.id, { types: ['prd', 'adr', 'roadmap', 'task-dag', 'design'] })
    // Planner task-size judgment: record the plan's scale. Plans with more than
    // 6 taskDag nodes route through per-node DAG execution in MissionRunner
    // (v3 P6); smaller plans stay on the single worker run.
    const dag = design.taskDag ?? []
    db.insertEvent('operator.plan_scale', 'mission', mission.id, {
      taskDagCount: dag.length,
      coderTaskCount: dag.filter((t) => t.role === 'coder').length,
      largePlan: dag.length > 6,
      note: 'Plans with >6 taskDag nodes execute per-node via the MissionRunner DAG path; smaller plans run in a single worker run.',
    })
    db.insertEvent('operator.cost_updated', 'operator_session', session.id, {
      scope: 'planner',
      provider: output.provider,
      authMode: output.authMode,
      inputTokens: output.inputTokens,
      outputTokens: output.outputTokens,
      costUsd: output.costUsd,
    })
    return { ok: true, mission: { ...mission, prdPath: join(stateDir, 'prd', `${mission.id}.md`) }, design }
  } catch (e) {
    return {
      ok: false,
      reason: `schema validation failed: ${(e as Error).message}`,
      message: `HOLD-ROADMAP-PLANNER: planner returned invalid MissionDesign JSON.\n\n${(e as Error).message}`,
    }
  }
}

/** Gather operator clarification answers for a session into planner-prompt lines (PRD §B step 3). */
function buildClarifications(db: AedevDb, sessionId: string): string {
  const events = db.queryEvents({ type: 'operator.questions_answered', entityId: sessionId })
  const lines: string[] = []
  for (const e of [...events].reverse()) {
    const answers = e.payload['answers']
    if (!Array.isArray(answers)) continue
    for (const a of answers as Array<Record<string, unknown>>) {
      if (!a || !a['value']) continue
      const field = String(a['field'] ?? 'note')
      const question = typeof a['question'] === 'string' ? a['question'] : undefined
      lines.push([
        `- field: ${field}`,
        question ? `  question: ${question}` : '',
        `  answer: ${String(a['value'])}`,
      ].filter(Boolean).join('\n'))
    }
  }
  return lines.join('\n')
}

async function runPlannerMissionDesign(
  prompt: string,
  title: string,
  repoId: string,
  missionId: string,
  clarifications = '',
  budget?: HeadlessBudgetCtx,
): Promise<{
  ok: true
  design: unknown
  provider: string
  authMode?: string
  inputTokens: number
  outputTokens: number
  costUsd: number | null
} | { ok: false; reason: string }> {
  const fixture = process.env['AEDEV_COCKPIT_PLANNER_FIXTURE_JSON']
  if (fixture) {
    try {
      return { ok: true, design: JSON.parse(fixture), provider: 'fixture', inputTokens: 0, outputTokens: 0, costUsd: null }
    } catch (e) {
      return { ok: false, reason: `planner fixture JSON parse failed: ${(e as Error).message}` }
    }
  }
  if (isTemplateRoadmapEnabled()) {
    return {
      ok: true,
      design: new LeadAgent(process.cwd()).designMission(missionId, prompt, title),
      provider: 'test-template',
      inputTokens: 0,
      outputTokens: 0,
      costUsd: null,
    }
  }

  const systemPrompt = [
    'You are the Claude Code 24/7 lead planner.',
    'Return one JSON object only. No markdown fence.',
    'The JSON must match this shape exactly:',
    '{"missionId":string,"title":string,"prd":{"summary":string,"goals":string[],"nonGoals":string[],"acceptanceCriteria":string[],"risks":string[],"rollbackPlan":string,"documentationImpact":string},"adrDraft":{"title":string,"context":string,"decision":string,"consequences":string},"roadmap":string[],"checkpoints":[{"id":string,"title":string,"reason":string,"required":boolean}],"taskDag":[{"id":string,"title":string,"role":"planner|architect|coder|reviewer|validator|doc-writer|repair","parentIds":string[],"contextFiles":string[],"writeFiles":string[],"expectedEvidence":string[],"checkpointGate":string|null}]}',
  ].join('\n')
  const plannerPrompt = [
    systemPrompt,
    '',
    `missionId: ${missionId}`,
    `title: ${title}`,
    `repoId: ${repoId}`,
    '',
    'User request:',
    prompt,
    ...(clarifications ? ['', 'Operator clarifications (treat as authoritative constraints):', clarifications] : []),
    '',
    'Design a low-risk evidence-gated mission. The taskDag must contain at least one coder task and expected evidence files.',
  ].join('\n')
  const timeoutMs = Number(process.env['AEDEV_COCKPIT_AI_TIMEOUT_MS'] ?? '300000')
  const provider = process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'claude'
  const failures: string[] = []

  // P1 credit guard (fixture/template paths above spawn nothing and stay free).
  if (budget) {
    const verdict = checkHeadlessBudget(budget.db, budget.sessionId)
    if (!verdict.allowed) {
      return { ok: false, reason: createBudgetHold(budget.db, budget.sessionId, verdict) }
    }
  }

  const claude = new ClaudeCodeAdapter()
  if (provider === 'claude' && await claude.isAvailable()) {
    const result = await claude.run(plannerPrompt, process.cwd(), { timeoutMs, permissionMode: 'bypassPermissions' })
    if (budget) {
      recordHeadlessCall(budget.db, budget.sessionId, {
        role: 'mission-design',
        provider: 'claude-cli',
        authMode: result.authMode,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        exitCode: result.exitCode,
      })
    }
    if (result.exitCode === 0 && result.transcript.trim()) {
      const parsed = extractJsonObject(result.transcript)
      if (parsed.ok) return {
        ok: true,
        design: parsed.value,
        provider: 'claude-cli',
        authMode: result.authMode,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      }
      failures.push(`claude-cli invalid JSON: ${parsed.reason}`)
    } else {
      failures.push(`claude-cli: ${result.error ?? `exit ${result.exitCode}`}`)
    }
  }

  if (provider !== 'claude') {
    failures.push(`unsupported planner provider '${provider}'; P1 requires claude-cli`)
  }

  return { ok: false, reason: failures.length ? failures.join('; ') : 'No healthy local Claude planner CLI found.' }
}

function extractJsonObject(text: string): { ok: true; value: unknown } | { ok: false; reason: string } {
  const trimmed = text.trim()
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)?.[1]?.trim()
  const candidate = fenced ?? trimmed.slice(trimmed.indexOf('{'), trimmed.lastIndexOf('}') + 1)
  try {
    return { ok: true, value: JSON.parse(candidate) }
  } catch (e) {
    return { ok: false, reason: (e as Error).message }
  }
}

function writeDesignArtifacts(db: AedevDb, stateDir: string, missionId: string, design: MissionDesign): void {
  const dir = join(stateDir, 'prd', missionId)
  const flatDir = join(stateDir, 'prd')
  mkdirSync(dir, { recursive: true })
  mkdirSync(flatDir, { recursive: true })
  const prdMd = renderPrdMarkdown(design)
  const adrMd = renderAdrMarkdown(design)
  const roadmapMd = renderRoadmapMarkdown(design)
  writeFileSync(join(dir, 'prd.md'), prdMd)
  writeFileSync(join(dir, 'adr.md'), adrMd)
  writeFileSync(join(dir, 'roadmap.md'), roadmapMd)
  writeFileSync(join(dir, 'task-dag.json'), JSON.stringify(design.taskDag, null, 2))
  writeFileSync(join(dir, 'design.json'), JSON.stringify(design, null, 2))
  writeFileSync(join(flatDir, `${missionId}.md`), prdMd)
  writeFileSync(join(flatDir, `${missionId}.design.json`), JSON.stringify(design, null, 2))
  db.upsertMissionArtifact({ missionId, type: 'prd', path: join(dir, 'prd.md'), title: 'PRD' })
  db.upsertMissionArtifact({ missionId, type: 'adr', path: join(dir, 'adr.md'), title: 'ADR draft' })
  db.upsertMissionArtifact({ missionId, type: 'roadmap', path: join(dir, 'roadmap.md'), title: 'Roadmap' })
  db.upsertMissionArtifact({ missionId, type: 'other', path: join(dir, 'task-dag.json'), title: 'Task DAG' })
  db.upsertMissionArtifact({ missionId, type: 'roadmap', path: join(dir, 'design.json'), title: 'Mission design JSON' })
}

function renderPrdMarkdown(design: MissionDesign): string {
  return [
    `# PRD: ${design.title}`,
    '',
    design.prd.summary,
    '',
    '## Goals',
    ...design.prd.goals.map((g) => `- ${g}`),
    '',
    '## Non-goals',
    ...(design.prd.nonGoals.length ? design.prd.nonGoals : ['No explicit non-goals supplied.']).map((g) => `- ${g}`),
    '',
    '## Acceptance Criteria',
    ...design.prd.acceptanceCriteria.map((a) => `- ${a}`),
    '',
    '## Risks',
    ...(design.prd.risks.length ? design.prd.risks : ['No major risks identified.']).map((r) => `- ${r}`),
    '',
    '## Rollback Plan',
    design.prd.rollbackPlan,
    '',
    '## Documentation Impact',
    design.prd.documentationImpact,
  ].join('\n')
}

function renderAdrMarkdown(design: MissionDesign): string {
  return [
    `# ADR Draft: ${design.adrDraft.title}`,
    '',
    '## Context',
    design.adrDraft.context,
    '',
    '## Decision',
    design.adrDraft.decision,
    '',
    '## Consequences',
    design.adrDraft.consequences,
  ].join('\n')
}

function renderRoadmapMarkdown(design: MissionDesign): string {
  return [
    `# Roadmap: ${design.title}`,
    '',
    ...design.roadmap.map((step, i) => `${i + 1}. ${step}`),
    '',
    '## Task DAG',
    ...design.taskDag.map((task) => `- ${task.id} [${task.role}]: ${task.title}`),
    '',
    '## Checkpoints',
    ...(design.checkpoints.length ? design.checkpoints : [{ id: 'evidence-gate', title: 'Evidence gate', reason: 'Operator review before PR or merge', required: true }]).map((c) => `- ${c.id}: ${c.title} (${c.required ? 'required' : 'optional'}) - ${c.reason}`),
  ].join('\n')
}

function registerDesignArtifacts(db: AedevDb, stateDir: string, missionId: string): void {
  const prd = join(stateDir, 'prd', `${missionId}.md`)
  const design = join(stateDir, 'prd', `${missionId}.design.json`)
  const dir = join(stateDir, 'prd', missionId)
  const standalone: Array<[string, MissionArtifact['type'], string]> = [
    ['prd.md', 'prd', 'PRD'],
    ['adr.md', 'adr', 'ADR draft'],
    ['roadmap.md', 'roadmap', 'Roadmap'],
    ['task-dag.json', 'other', 'Task DAG'],
    ['design.json', 'roadmap', 'Mission design JSON'],
  ]
  for (const [file, type, title] of standalone) {
    const path = join(dir, file)
    if (existsSync(path)) db.upsertMissionArtifact({ missionId, type, path, title })
  }
  if (existsSync(prd)) db.upsertMissionArtifact({ missionId, type: 'prd', path: prd, title: 'PRD' })
  if (existsSync(design)) {
    db.upsertMissionArtifact({ missionId, type: 'roadmap', path: design, title: 'Mission design JSON' })
    db.upsertMissionArtifact({ missionId, type: 'adr', path: design, title: 'ADR draft in mission design' })
  }
}

export function registerEvidenceArtifacts(db: AedevDb, missionId: string, evidenceDir: string): void {
  if (!existsSync(evidenceDir)) return
  db.upsertMissionArtifact({ missionId, type: 'evidence', path: evidenceDir, title: 'Evidence directory' })
  const known: Array<[string, MissionArtifact['type'], string]> = [
    ['prd.md', 'prd', 'PRD'],
    ['adr-mission.md', 'adr', 'ADR draft'],
    ['roadmap.md', 'roadmap', 'Roadmap'],
    ['workbook-summary.md', 'report', 'Workbook summary'],
    ['test-summary.md', 'report', 'Test summary'],
    ['risk-report.md', 'report', 'Risk report'],
    ['transcript-summary.md', 'report', 'Worker transcript'],
    ['model-usage.json', 'report', 'Model usage'],
    // P6: surface the Docker worker's real change evidence so the cockpit
    // Working folder / overview artifacts show the diff + done report, not just docs.
    ['diff-summary.md', 'report', 'Worker diff'],
    ['done-report.md', 'report', 'Done report'],
    ['changed-paths.json', 'report', 'Changed paths'],
    ['local-commit.json', 'report', 'Local commit'],
  ]
  for (const [file, type, title] of known) {
    const path = join(evidenceDir, file)
    if (existsSync(path)) db.upsertMissionArtifact({ missionId, type, path, title })
  }
}

function readDraftPrEvidence(evidenceDir: string): { changedPaths: string[]; branch?: string; worktreePath?: string } {
  const changedPath = join(evidenceDir, 'changed-paths.json')
  const commitPath = join(evidenceDir, 'local-commit.json')
  let changedPaths: string[] = []
  let worktreePath: string | undefined
  if (existsSync(changedPath)) {
    try {
      const parsed = JSON.parse(readFileSync(changedPath, 'utf8')) as { changedPaths?: unknown; worktreePath?: unknown }
      if (Array.isArray(parsed.changedPaths)) {
        changedPaths = parsed.changedPaths.filter((p): p is string => typeof p === 'string')
      }
      if (typeof parsed.worktreePath === 'string' && parsed.worktreePath) worktreePath = parsed.worktreePath
    } catch { /* ignored; DraftPrGate still fail-closes on forbidden paths it can see */ }
  }
  if (!existsSync(commitPath)) return { changedPaths, ...(worktreePath ? { worktreePath } : {}) }
  try {
    const parsed = JSON.parse(readFileSync(commitPath, 'utf8')) as { branch?: unknown }
    const branch = typeof parsed.branch === 'string' && parsed.branch ? parsed.branch : undefined
    return { changedPaths, ...(branch ? { branch } : {}), ...(worktreePath ? { worktreePath } : {}) }
  } catch {
    return { changedPaths, ...(worktreePath ? { worktreePath } : {}) }
  }
}

/** True when the cockpit uses the deterministic mock runner instead of a real local CLI.
 *  Mock mode skips repo-bound execution (used by the UI e2e/screenshot harnesses). */
function operatorForceMock(): boolean {
  if (/^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_FORCE_REAL'] ?? '')) return false
  return /^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_FORCE_MOCK'] ?? '') ||
    (isTestRuntime() && process.env['AEDEV_COCKPIT_FORCE_REAL'] !== '1')
}

async function runOperatorMission(db: AedevDb, stateDir: string, sessionId: string, missionId: string) {
  const dockerWorker = cockpitDockerWorkerEnabled()
  const plannerCoderEnv = buildPlannerCoderEnv()
  const forceMock = operatorForceMock()
  const workerSessions = forceMock
    ? []
    : [
        ...(dockerWorker ? [dockerWorkerSession()] : []),
        ...await discoverWorkerSessions({
          env: plannerCoderEnv,
          probeSessions: !/^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_SKIP_SESSION_PROBE'] ?? ''),
        }),
      ]
  recordDiscoveryProbe(db, sessionId, workerSessions)
  const validatorConfig = buildCockpitValidatorConfig(missionId)
  if (validatorConfig.configuredCount === 0) {
    db.insertEvent('operator.validators_not_configured', 'mission', missionId, {
      status: 'not_configured',
      note: 'Gemini validator key is not configured; Draft PR remains blocked until Gemini returns PASS.',
    })
  }
  const mission = db.getMission(missionId)
  const repo = mission ? db.getRepo(mission.repoId) : undefined
  const runnerConfig = repo ? {
    mode: dockerWorker ? 'claude-docker' as const : 'mock' as const,
    maxConcurrentWorkers: 1,
    worktreeBaseDir: join(stateDir, dockerWorker ? 'operator-docker-workspaces' : 'worktrees'),
    outputBaseDir: join(stateDir, dockerWorker ? 'operator-docker-evidence' : 'evidence', 'tasks'),
    sourceRepoPath: repo.path,
    testCommands: repo.testCommands,
    forbiddenPaths: repo.forbiddenPaths,
    branchPrefix: `operator/${missionId.slice(0, 8)}`,
  } : undefined
  const runnerOpts = forceMock
      ? { runner: operatorDraftRunner(db, stateDir) }
    : dockerWorker && runnerConfig
      ? { workerSessions, runner: operatorDockerRunner(db, runnerConfig) }
      : { workerSessions, runner: operatorLocalCliRunner(db, stateDir, workerSessions) }
  db.insertEvent('operator.worker_assigned', 'mission', missionId, {
    sessionId,
    mode: forceMock ? 'mock' : dockerWorker ? 'claude-docker' : 'local-cli',
    availableSessions: workerSessions.length,
    paidApiKeysStripped: true,
  })
  if (validatorConfig.configuredCount > 0) {
    db.insertEvent('operator.validator_started', 'mission', missionId, { sessionId, count: validatorConfig.configuredCount })
  }
  const result = await new MissionRunner(db, {
    stateDir,
    rolePipeline: new RolePipeline(),
    ...(runnerConfig ? { runnerConfig } : {}),
    ...runnerOpts,
    ...validatorConfig.runnerOptions,
    // P2 cross-engine review: real missions get a Claude evidence-only
    // reviewer before the Gemini final judge (GR#9); mock mode skips it.
    ...(forceMock ? {} : {
      reviewer: new ClaudeReviewer({ db, budgetKey: sessionId }),
      onReviewVerdict: (verdict, cycle) => {
        db.insertOperatorMessage({
          sessionId,
          role: 'assistant',
          content: renderReviewVerdictBubble(verdict, cycle),
        })
      },
    }),
    requiresDualValidatorGate: false,
    riskFactors: () => ({
      touchesForbiddenPaths: false,
      diffLinesChanged: 0,
      hasDependencyChanges: false,
      testCoverageDecreased: false,
      usesSecrets: false,
      hasMigrationChanges: false,
      hasControlPlaneChanges: false,
    }),
  }).runMission(missionId)
  for (const v of result.validatorResults) {
    db.insertValidatorResult({
      taskId: result.taskId,
      runId: result.run.runId,
      validator: v.validator,
      verdict: v.verdict,
      summary: v.summary,
      evidenceBundlePath: result.evidenceDir,
    })
    db.insertEvent('operator.validator_result', 'mission', missionId, { validator: v.validator, verdict: v.verdict, summary: v.summary })
  }
  if (result.validatorResults.length > 0) {
    db.insertEvent('operator.validator_done', 'mission', missionId, {
      sessionId,
      count: result.validatorResults.length,
      verdicts: result.validatorResults.map((v) => v.verdict),
    })
  }
  registerEvidenceArtifacts(db, result.missionId, result.evidenceDir)
  db.insertEvent('operator.evidence_written', 'mission', missionId, { sessionId, evidenceDir: result.evidenceDir })
  // Cancellation fence: if the operator pressed Stop while the worker was running,
  // keep the session cancelled and discard the late worker result.
  if (skipFinalWriteIfCancelled(db, missionId, 'operator.runMission.session', result.status)) {
    db.updateOperatorSession(sessionId, { status: 'cancelled' })
  } else {
    db.updateOperatorSession(sessionId, { status: result.status })
    db.insertEvent('operator.stage_changed', 'mission', missionId, { stage: 'PR/Waiting/Blocked', sessionId, status: result.status })
  }
  return result
}

function cockpitDockerWorkerEnabled(): boolean {
  if (/^(1|true|yes|docker)$/i.test(process.env['AEDEV_COCKPIT_WORKER'] ?? '')) return true
  return Boolean(process.env['AEDEV_CLAUDE_DOCKER_IMAGE'] && process.env['AEDEV_CLAUDE_OAUTH_TOKEN'])
}

function dockerWorkerSession() {
  return {
    id: 'claude-docker',
    provider: 'claude-docker' as const,
    family: 'anthropic' as const,
    healthy: true,
    active: 0,
    probeStatus: 'skipped' as const,
    probedAt: new Date().toISOString(),
  }
}

function operatorDockerRunner(db: AedevDb, runnerConfig: NonNullable<Parameters<ClaudeDockerRunner['run']>[1]>) {
  const runner = new ClaudeDockerRunner({
    image: process.env['AEDEV_CLAUDE_DOCKER_IMAGE'] ?? 'claude-code-247/runner:latest',
    timeoutMs: Number(process.env['AEDEV_COCKPIT_WORKER_TIMEOUT_MS'] ?? '600000'),
  })
  return {
    async runTask(task: Task) {
      const run = db.insertRun({
        taskId: task.id,
        runnerMode: 'claude-docker',
        status: 'running',
        startedAt: new Date().toISOString(),
      })
      db.updateTaskStatus(task.id, 'running')
      try {
        const result = await runner.run(task, runnerConfig)
        db.updateRun(run.id, {
          status: result.exitCode === 0 ? 'done' : 'failed',
          completedAt: new Date().toISOString(),
          exitCode: result.exitCode,
          evidenceDir: result.evidenceDir,
        })
        db.updateTaskStatus(task.id, result.exitCode === 0 ? 'done' : 'failed')
        return { ...result, runId: run.id }
      } catch (e) {
        db.updateRun(run.id, {
          status: 'failed',
          completedAt: new Date().toISOString(),
          exitCode: 1,
          errorMessage: (e as Error).message,
        })
        db.updateTaskStatus(task.id, 'failed')
        throw e
      }
    },
  }
}

function operatorDraftRunner(db: AedevDb, stateDir: string) {
  return {
    async runTask(task: Task) {
      // Optional hold so the cockpit shows a genuine in-progress state (used by screenshot QA).
      const delayMs = Math.max(0, Number(process.env['AEDEV_COCKPIT_MOCK_DELAY_MS'] ?? '0'))
      const started = new Date().toISOString()
      const startedMs = Date.now()
      const evidenceDir = join(stateDir, 'operator-evidence', task.id)
      mkdirSync(evidenceDir, { recursive: true })
      const logPath = join(evidenceDir, 'operator-run.log')
      writeFileSync(logPath, `[${nowIso()}] mock worker started for task ${task.id}\n`)
      const run = db.insertRun({
        taskId: task.id,
        runnerMode: 'mock',
        status: 'running',
        startedAt: started,
        evidenceDir,
      })
      db.updateTaskStatus(task.id, 'running')
      db.insertEvent('operator.worker_started', 'mission', task.missionId, { taskId: task.id, runId: run.id, provider: 'mock', evidenceDir })
      db.insertEvent('operator.task_progress', 'task', task.id, { progress: 0.5, evidenceDir })
      if (delayMs > 0) await new Promise((resolve) => setTimeout(resolve, delayMs))
      appendFileSync(logPath, `[${nowIso()}] mock worker completed evidence gate\n`)
      writeFileSync(join(evidenceDir, 'plan.md'), `# Plan\n\nExecute mission ${task.missionId} to the draft PR/evidence gate from Operator Cockpit.\n`)
      writeFileSync(join(evidenceDir, 'diff-summary.md'), '# Diff Summary\n\nNo repository diff was produced by the cockpit draft runner.\n')
      writeFileSync(join(evidenceDir, 'test-summary.md'), '# Test Summary\n\nNo test command was supplied to the cockpit draft runner.\n')
      writeFileSync(join(evidenceDir, 'done-report.md'), '# Done Report\n\nOperator Cockpit reached the draft PR/evidence gate. Remote writes and merge remain policy-gated.\n')
      db.updateRun(run.id, { status: 'done', completedAt: new Date().toISOString(), exitCode: 0, evidenceDir })
      db.updateTaskStatus(task.id, 'done')
      db.insertEvent('operator.task_progress', 'task', task.id, { progress: 1, evidenceDir })
      db.insertEvent('operator.worker_log', 'mission', task.missionId, { taskId: task.id, runId: run.id, stream: 'stdout', chunk: 'mock worker completed evidence gate' })
      return {
        runId: run.id,
        taskId: task.id,
        exitCode: 0,
        evidenceDir,
        durationMs: Date.now() - startedMs,
      }
    },
  }
}

function buildCockpitValidatorConfig(missionId: string) {
  if (/^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_FAKE_VALIDATORS'] ?? '')) {
    return {
      configuredCount: 1,
      runnerOptions: { validators: [new MockValidator('pass')] },
    }
  }
  const placeholderTaskId = `operator-${missionId}-pending`
  const status = inspectDefaultMissionValidatorSecrets({ missionId, taskId: placeholderTaskId })
  return {
    configuredCount: status.configuredCount,
    runnerOptions: { validatorFactory: createDefaultMissionValidatorFactory() },
  }
}

function isTemplateRoadmapEnabled(): boolean {
  if (process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] !== undefined) {
    return /^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'])
  }
  return isTestRuntime()
}

function isTestRuntime(): boolean {
  const globalFlag = (globalThis as typeof globalThis & { __AEDEV_TEST_RUNTIME__?: boolean }).__AEDEV_TEST_RUNTIME__ === true
  const argv = process.argv.join(' ')
  const title = process.title
  return Boolean(
    globalFlag ||
    process.env['VITEST'] ||
    process.env['VITEST_WORKER_ID'] ||
    process.env['VITEST_POOL_ID'] ||
    process.env['NODE_ENV'] === 'test' ||
    /\bvitest\b/i.test(argv) ||
    /\bvitest\b/i.test(title),
  )
}

/** Injectable adapter runners (default to the real CLIs); tests pass fakes that
 *  exercise the repo-bound worktree without a live Claude/Codex session. */
export interface OperatorRunnerDeps {
  runClaude?: (prompt: string, workdir: string, options: Parameters<ClaudeCodeAdapter['run']>[2]) => Promise<Awaited<ReturnType<ClaudeCodeAdapter['run']>>>
  runCodex?: (prompt: string, workdir: string, options: Parameters<CodexCliAdapter['run']>[2]) => Promise<Awaited<ReturnType<CodexCliAdapter['run']>>>
}

export function operatorLocalCliRunner(
  db: AedevDb,
  stateDir: string,
  sessions: Awaited<ReturnType<typeof discoverWorkerSessions>>,
  deps: OperatorRunnerDeps = {},
) {
  return {
    async runTask(task: Task) {
      const session = sessions.find((s) => s.healthy && s.provider === 'codex-cli')
      if (!session) throw new Error('HOLD-SESSION-POOL: no healthy Codex CLI session is available')
      const started = new Date().toISOString()
      const startedMs = Date.now()
      const evidenceDir = join(stateDir, 'operator-evidence', task.id)
      mkdirSync(evidenceDir, { recursive: true })
      const logPath = join(evidenceDir, 'operator-run.log')

      // P0 trust fix: the worker MUST run inside an isolated git worktree of the
      // operator's selected repo — not an empty scratch dir.  An invalid repo HOLDs.
      const repo = db.getRepo(task.repoId)
      let workspace
      try {
        workspace = await createRepoBoundWorkspace(repo!, task.id, stateDir)
      } catch (e) {
        const reason = (e as Error).message
        db.insertEvent('operator.hold_created', 'mission', task.missionId, { holdCode: TARGET_REPO_HOLD, reason, taskId: task.id })
        db.insertHold({ entityType: 'mission', entityId: task.missionId, code: TARGET_REPO_HOLD, reason, nextAction: 'Register a valid, enabled git repo for this mission, then start again.' })
        throw e instanceof TargetRepoUnavailableError ? e : new TargetRepoUnavailableError(reason)
      }
      const workdir = workspace.worktreePath
      const forbiddenPaths = repo!.forbiddenPaths?.length ? repo!.forbiddenPaths : ['.env*', 'secrets/**', '.github/**', 'AGENTS.md', 'CLAUDE.md']
      const memoryContext = buildMemoryContext(repo!)
      writeFileSync(logPath, `[${nowIso()}] starting ${session.provider} worker for task ${task.id} in repo-bound worktree ${workdir}\n`)
      const run = db.insertRun({
        taskId: task.id,
        runnerMode: 'codex-cli',
        status: 'running',
        startedAt: started,
        evidenceDir,
      })
      db.updateTaskStatus(task.id, 'running')
      db.insertEvent('operator.repo_bound_workspace_ready', 'mission', task.missionId, {
        taskId: task.id, runId: run.id, repoId: repo!.id, repoPath: repo!.path,
        worktreePath: workdir, branch: repo!.defaultBranch, baseSha: workspace.baseSha, dirtyStatus: workspace.dirty ? 'dirty' : 'clean',
      })
      db.insertEvent('operator.worker_started', 'mission', task.missionId, { taskId: task.id, runId: run.id, provider: session.provider, workdir, evidenceDir, repoId: repo!.id })
      const appendLog = (stream: 'stdout' | 'stderr', chunk: string) => {
        mkdirSync(evidenceDir, { recursive: true })
        appendFileSync(logPath, `[${nowIso()}] ${stream}: ${chunk}`)
        db.insertEvent('operator.worker_log', 'mission', task.missionId, { taskId: task.id, runId: run.id, stream, chunk: chunk.slice(0, 1200) })
      }

      const prompt = [
        task.prompt,
        '',
        'Run as an evidence-gate worker for the Operator Cockpit.',
        `Target repository: ${repo!.name}`,
        `Working directory (an isolated git worktree of the repo): ${workdir}`,
        `Default branch: ${repo!.defaultBranch}`,
        `Evidence directory (read-only for you): ${evidenceDir}`,
        memoryContext,
        'Make the smallest real change for this mission to repository files in your working directory.',
        'Do not push to GitHub, do not merge, and do not edit these forbidden paths: ' + forbiddenPaths.join(', ') + '.',
        'Stop at the evidence gate: leave the changes in the worktree and return a concise markdown report with Plan, Concrete steps, Risks, Tests/checks, Done report.',
      ].join('\n')
      const timeoutMs = Number(process.env['AEDEV_COCKPIT_WORKER_TIMEOUT_MS'] ?? '600000')
      const timeoutSource = process.env['AEDEV_COCKPIT_WORKER_TIMEOUT_MS'] ? 'env:AEDEV_COCKPIT_WORKER_TIMEOUT_MS' : 'default'
      // Task-scale + timeout transparency (point 3): the whole mission runs in this
      // single worker run, so record the budget it has to fit within up front.
      db.insertEvent('operator.worker_scale', 'mission', task.missionId, {
        taskId: task.id, runId: run.id, provider: session.provider,
        workerTimeoutMs: timeoutMs, timeoutSource, promptChars: prompt.length,
      })
      const result = await (deps.runCodex ?? ((p, cwd, o) => new CodexCliAdapter().run(p, cwd, o)))(prompt, workdir, { timeoutMs, sandbox: 'workspace-write', approvalPolicy: 'never', onStdout: (chunk) => appendLog('stdout', chunk), onStderr: (chunk) => appendLog('stderr', chunk) })
      const transcript = result.transcript || result.error || '(no transcript)'
      appendFileSync(logPath, `\n[${nowIso()}] completed exitCode=${result.exitCode}\n`)

      // Real repository diff from the worktree (honest evidence; feeds the engine's
      // forbidden-path BLOCK gate via changed-paths.json).
      const diff = await collectWorkspaceDiff(workdir, workspace.baseSha, forbiddenPaths)
      writeFileSync(join(evidenceDir, 'changed-paths.json'), JSON.stringify({
        changedPaths: diff.changedPaths,
        forbiddenHits: diff.forbiddenHits,
        repoPath: repo!.path,
        worktreePath: workdir,
        baseSha: workspace.baseSha,
      }, null, 2))
      writeFileSync(join(evidenceDir, 'transcript-summary.md'), transcript)
      writeFileSync(join(evidenceDir, 'plan.md'), `# Plan\n\n${transcript}\n`)
      writeFileSync(join(evidenceDir, 'diff-summary.md'), diff.summary)
      writeFileSync(join(evidenceDir, 'test-summary.md'), [
        '# Test Summary', '',
        `Provider: ${session.provider}`,
        `Worker exit code: ${result.exitCode}`,
        `Duration: ${Math.round(result.durationMs / 1000)}s`,
        `Worker timeout: ${timeoutMs}ms (source: ${timeoutSource})`,
        `Repository files changed: ${diff.changedPaths.length}`,
        diff.forbiddenHits.length ? `Forbidden-path hits: ${diff.forbiddenHits.join(', ')}` : 'Forbidden-path scan: PASS',
        ...(result.error ? [`Error: ${result.error}`] : []),
        ...(result.exitCode === 124
          ? ['', 'Timed out at the worker budget — the worker was killed, not stuck. The full step trace (searches, commands, agent messages) is in operator-run.log. Raise AEDEV_COCKPIT_WORKER_TIMEOUT_MS or split the mission into smaller runs.']
          : []),
        '',
      ].join('\n'))
      writeFileSync(join(evidenceDir, 'done-report.md'), [
        '# Done Report', '',
        `Task: ${task.id}`,
        `Provider: ${session.provider}`,
        `Repo: ${repo!.name} (${repo!.path})`,
        `Worktree: ${workdir}`,
        `Worker exit code: ${result.exitCode}`,
        `Repository files changed: ${diff.changedPaths.length}`,
      ].join('\n') + '\n')
      writeFileSync(join(evidenceDir, 'model-usage.json'), JSON.stringify({
        provider: session.provider,
        authMode: result.authMode,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
        durationMs: result.durationMs,
      }, null, 2))
      db.upsertMissionArtifact({ missionId: task.missionId, type: 'report', path: logPath, title: 'Operator worker log' })
      db.updateRun(run.id, {
        status: result.exitCode === 0 ? 'done' : 'failed',
        completedAt: new Date().toISOString(),
        exitCode: result.exitCode,
        evidenceDir,
        ...(result.error ? { errorMessage: result.error } : {}),
      })
      db.updateTaskStatus(task.id, result.exitCode === 0 ? 'done' : 'failed')
      db.insertEvent('operator.cost_updated', 'mission', task.missionId, {
        runId: run.id,
        provider: session.provider,
        authMode: result.authMode,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      })
      db.insertEvent('operator.task_progress', 'task', task.id, { progress: 1, evidenceDir, provider: session.provider, exitCode: result.exitCode, changedPaths: diff.changedPaths.length })
      return {
        runId: run.id,
        taskId: task.id,
        exitCode: result.exitCode,
        evidenceDir,
        durationMs: Date.now() - startedMs,
      }
    },
  }
}

const READABLE_STATUS: Record<string, string> = {
  'operator.session.created': 'Session created',
  'operator.stage_changed': 'Stage changed',
  'operator.role_started': 'Planner started',
  'operator.role_done': 'Planner finished',
  'operator.roadmap_generation_started': 'Generating PRD / Roadmap',
  'operator.roadmap_generation_done': 'PRD / Roadmap ready',
  'operator.artifact_written': 'Artifacts written',
  'operator.approval_recorded': 'Roadmap approved',
  'operator.worker_assigned': 'Worker assigned',
  'operator.worker_started': 'Worker started',
  'operator.worker_log': 'Worker output',
  'operator.task_progress': 'Worker progress',
  'operator.worker_failed': 'Worker failed',
  'operator.validator_started': 'Validators started',
  'operator.validator_result': 'Validator result',
  'operator.validator_done': 'Validators done',
  'operator.evidence_written': 'Evidence written',
  'operator.draft_pr_created': 'Draft PR created',
  'operator.draft_pr_blocked': 'Draft PR blocked',
  'operator.hold_created': 'Blocked (HOLD)',
  'operator.hold_resolved': 'HOLD resolved',
  'operator.questions_answered': 'Clarifications received',
}

/** Map a raw event type to a human-readable status label (PRD §E). */
function readableStatus(type: string | undefined): string {
  if (!type) return ''
  return READABLE_STATUS[type] ?? type.replace(/^operator\./, '').replace(/[._]/g, ' ')
}

export interface RunProgress {
  runId: string
  status: string
  exitCode: number | null
  startedAt: string | null
  lastHeartbeatAt: string | null
  elapsedMs: number | null
  sinceHeartbeatMs: number | null
  stalled: boolean
  lastProgressLabel: string
}

/** Heartbeat + stalled detection for the live execution view (PRD §E). */
function computeRunProgress(latestRun: Run | undefined, events: Array<{ type: string; createdAt: string }>): RunProgress | null {
  if (!latestRun) return null
  const heartbeatTypes = new Set(['operator.worker_log', 'operator.task_progress', 'operator.worker_started'])
  const beats = events.filter((e) => heartbeatTypes.has(e.type)) // events arrive newest-first
  const startedAt = latestRun.startedAt ?? null
  const lastHeartbeatAt = beats[0]?.createdAt ?? startedAt
  const now = Date.now()
  const elapsedMs = startedAt ? now - new Date(startedAt).getTime() : null
  const sinceHeartbeatMs = lastHeartbeatAt ? now - new Date(lastHeartbeatAt).getTime() : null
  const stallMs = Number(process.env['AEDEV_COCKPIT_STALL_MS'] ?? '90000')
  const stalled = latestRun.status === 'running' && sinceHeartbeatMs !== null && sinceHeartbeatMs > stallMs
  return {
    runId: latestRun.id,
    status: latestRun.status,
    exitCode: latestRun.exitCode ?? null,
    startedAt,
    lastHeartbeatAt,
    elapsedMs,
    sinceHeartbeatMs,
    stalled,
    lastProgressLabel: readableStatus(events.find((e) => e.type.startsWith('operator.'))?.type),
  }
}

function labelForOperatorStage(stage: OperatorMissionStage): string {
  return ({
    intake: 'Intake · 接收目标',
    new: 'New mission · 新任务',
    understanding: 'Understanding · 正在理解需求',
    understanding_ready: 'Understanding ready · 已完成初步理解',
    brainstorming: 'Understanding · 正在理解需求',
    clarifying: 'Clarify requirements · 先确认需求',
    roadmap_ready: 'Ready to generate plan · 可生成方案',
    pending_approval: 'Roadmap approval · 路线图待批准',
    approved: 'Ready to execute · 可启动执行',
    running: 'Worker running · Worker 正在执行',
    evidence_ready: 'Evidence ready · 证据已就绪',
    validating: 'Independent review · 独立验证中',
    validators_ready: 'Validators complete · 验证完成',
    validators_missing: 'Validators not configured · 验证器未配置',
    pr_blocked: 'PR blocked by policy · PR 被安全门拦截',
    pr_ready: 'Draft PR gate ready · 可检查 PR 安全门',
    pr_created: 'Draft PR created · 草稿 PR 已创建',
    learned: 'Learned · 已沉淀记忆',
    failed: 'Failed · 执行失败',
    cancelled: 'Cancelled · 已取消',
  } as Record<OperatorMissionStage, string>)[stage]
}

function stageProgress(stage: OperatorMissionStage): number {
  return ({
    intake: 0,
    new: 0,
    understanding: 12,
    understanding_ready: 24,
    brainstorming: 12,
    clarifying: 18,
    roadmap_ready: 30,
    pending_approval: 40,
    approved: 50,
    running: 65,
    evidence_ready: 78,
    validating: 82,
    validators_missing: 84,
    validators_ready: 88,
    pr_ready: 92,
    pr_blocked: 95,
    pr_created: 100,
    learned: 100,
    failed: 100,
    cancelled: 100,
  } as Record<OperatorMissionStage, number>)[stage]
}

function primaryActionForStage(stage: OperatorMissionStage): OperatorActionView | undefined {
  return ({
    new: { id: 'start-brainstorm', label: 'Start Brainstorm · 开始讨论', kind: 'primary' },
    understanding_ready: { id: 'generate-plan', label: 'Generate Plan · 生成方案', kind: 'primary' },
    roadmap_ready: { id: 'generate-plan', label: 'Generate Plan · 生成方案', kind: 'primary' },
    pending_approval: { id: 'approve-roadmap', label: 'Approve Roadmap · 批准路线', kind: 'primary' },
    approved: { id: 'start-execution', label: 'Start Execution · 启动执行', kind: 'primary' },
    evidence_ready: { id: 'check-draft-pr-gate', label: 'Check Draft PR Gate · 检查 PR 安全门', kind: 'primary' },
    validators_missing: { id: 'check-draft-pr-gate', label: 'Check Draft PR Gate · 检查 PR 安全门', kind: 'primary' },
    validators_ready: { id: 'check-draft-pr-gate', label: 'Check Draft PR Gate · 检查 PR 安全门', kind: 'primary' },
    pr_ready: { id: 'check-draft-pr-gate', label: 'Check Draft PR Gate · 检查 PR 安全门', kind: 'primary' },
    pr_blocked: { id: 'check-draft-pr-gate', label: 'Re-check Draft PR Gate · 重新检查 PR 安全门', kind: 'primary' },
    failed: { id: 'start-over', label: 'Start Over · 重新开始', kind: 'primary' },
    cancelled: { id: 'start-over', label: 'Start Over · 重新开始', kind: 'primary' },
  } as Partial<Record<OperatorMissionStage, OperatorActionView>>)[stage]
}

function prGateRemediation(code?: string): string {
  if (code === 'DRAFT_PR_EXECUTOR_UNAVAILABLE') {
    return 'Configure the remote-write executor and GitHub auth before creating a real Draft PR. No branch push or PR was created.'
  }
  return 'Remote writes are disabled for safety. Enable repo-scoped allow_remote_writes only when you want the worker to push a branch and open a Draft PR; until then no push, PR, or merge occurs.'
}

function inferOperatorStage(opts: {
  mission: { status: string; githubPrUrl?: string | null }
  session?: { status: string; prompt?: string } | undefined
  runs: Run[]
  validators: ValidatorResult[]
  validatorStatus: string
  events: Array<{ type: string; payload: Record<string, unknown> }>
}): OperatorMissionStage {
  if (opts.mission.githubPrUrl) return 'pr_created'
  if (opts.events.some((e) => e.type === 'operator.draft_pr_blocked')) return 'pr_blocked'
  if (opts.mission.status === 'failed') return 'failed'
  if (opts.mission.status === 'cancelled') return 'cancelled'
  if (opts.mission.status === 'running' || opts.session?.status === 'running' || opts.runs.some((r) => r.status === 'running')) return 'running'
  if (opts.mission.status === 'approved' || opts.session?.status === 'approved') return 'approved'
  if (opts.mission.status === 'pending_approval' || opts.session?.status === 'roadmap_ready') return 'pending_approval'
  if (opts.runs.some((r) => r.status === 'done') || opts.session?.status === 'waiting' || opts.mission.status === 'paused' || opts.mission.status === 'done') {
    if (opts.validatorStatus === 'not_configured') return 'validators_missing'
    if (opts.validatorStatus === 'pending') return 'validating'
    if (opts.validators.length > 0) return 'validators_ready'
    return 'evidence_ready'
  }
  if (opts.session?.status === 'brainstorming') return 'understanding'
  if (opts.session?.status === 'clarifying') return 'clarifying'
  if (opts.session?.status === 'brainstorm_ready') return 'understanding_ready'
  return 'new'
}

function buildProviderSummary(
  latestRun: Run | undefined,
  validators: ValidatorResult[],
  validatorStatus: string,
  validatorSecretStatus: ReturnType<typeof inspectDefaultMissionValidatorSecrets>,
  cost: ReturnType<typeof summarizeCost>,
  events: Array<{ type: string; entityType?: string; payload: Record<string, unknown> }>,
): OperatorMissionView['providerSummary'] {
  const plannerEvent = events.find((e) => e.type === 'operator.role_done' || e.type === 'operator.cost_updated')
    ?? events.find((e) => e.type === 'operator.role_started')
  const plannerProvider = typeof plannerEvent?.payload['provider'] === 'string'
    ? plannerEvent.payload['provider'] as string
    : process.env['AEDEV_COCKPIT_FORCE_MOCK'] ? 'test-synthetic' : process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'claude'
  const plannerTokens = cost.plannerTokens
  const validatorsView: ProviderMode[] = validators.length
    ? validators.map((v) => ({ name: v.validator, mode: 'validator-api-only', status: v.verdict }))
    : validatorStatus !== 'not_configured' && validatorSecretStatus.configuredCount > 0
      ? [
          ...(validatorSecretStatus.geminiConfigured ? [{ name: 'gemini', mode: 'validator-api-only' as const, status: validatorStatus }] : []),
        ]
    : [{ name: 'gemini', mode: validatorStatus === 'not_configured' ? 'not_configured' : 'unknown', status: validatorStatus }]
  return {
    planner: {
      name: plannerProvider,
      mode: plannerProvider === 'test-synthetic' || plannerProvider === 'mock' ? 'mock' : 'subscription-local',
      status: plannerEvent ? readableStatus(plannerEvent.type) : 'pending',
      tokens: plannerTokens,
    },
    worker: latestRun ? {
      name: latestRun.runnerMode,
      mode: latestRun.runnerMode === 'mock' ? 'mock' : 'subscription-local',
      status: latestRun.status,
      tokens: cost.workerTokens,
    } : undefined,
    validators: validatorsView,
  }
}

function latestPlannerQuestions(db: AedevDb, sessionId?: string): OperatorQuestion[] {
  if (!sessionId) return []
  const messages = db.listOperatorMessages(sessionId)
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]!
    if (message.role === 'assistant' && message.questions?.length) return message.questions
  }
  return []
}

function buildUnderstandingSummary(db: AedevDb, sessionId: string | undefined, stage: OperatorMissionStage, questions: OperatorQuestion[]) {
  const roundsCompleted = sessionId ? db.queryEvents({ type: 'operator.questions_answered', entityId: sessionId, limit: 50 }).length : 0
  const eventConfidence = latestClarifyConfidence(db, sessionId)
  const fallbackConfidence = Math.min(98, Math.max(
    stage === 'new' ? 0 : 25,
    38 + roundsCompleted * 24 + (stageProgress(stage) >= 40 ? 22 : 0) + (questions.length > 0 ? 8 : 0),
  ))
  const confidence = eventConfidence.confidence ?? fallbackConfidence
  return {
    confidence,
    understanding: {
      roundsCompleted,
      questions,
      readyReason: confidence >= 95 && questions.length === 0
        ? 'Planner confidence is at least 95% and no clarification questions are pending.'
        : 'Planner still needs more operator context before this is a high-confidence plan.',
    },
  }
}

function buildProjectPulse(opts: {
  stage: OperatorMissionStage
  repo?: { path: string } | undefined
  latestRun?: Run
  artifacts: Array<MissionArtifact & { preview?: string | null }>
  validators: ValidatorResult[]
  validatorStatus: string
  events: Array<{ id: string; type: string; payload: Record<string, unknown> }>
}): OperatorMissionView['projectPulse'] {
  const stages: Array<{ id: string; label: string; gates: OperatorMissionStage[] }> = [
    { id: 'understand', label: 'Understand · 理解需求', gates: ['understanding', 'understanding_ready', 'roadmap_ready', 'pending_approval', 'approved', 'running', 'evidence_ready', 'validating', 'validators_missing', 'validators_ready', 'pr_ready', 'pr_blocked', 'pr_created', 'learned'] },
    { id: 'roadmap', label: 'Roadmap · 路线图', gates: ['pending_approval', 'approved', 'running', 'evidence_ready', 'validating', 'validators_missing', 'validators_ready', 'pr_ready', 'pr_blocked', 'pr_created', 'learned'] },
    { id: 'execute', label: 'Execute · 本地执行', gates: ['running', 'evidence_ready', 'validating', 'validators_missing', 'validators_ready', 'pr_ready', 'pr_blocked', 'pr_created', 'learned'] },
    { id: 'validate', label: 'Validate · 独立验证', gates: ['validating', 'validators_missing', 'validators_ready', 'pr_ready', 'pr_blocked', 'pr_created', 'learned'] },
    { id: 'pr-gate', label: 'PR Gate · PR 安全门', gates: ['pr_ready', 'pr_blocked', 'pr_created', 'learned'] },
    { id: 'learn', label: 'Learn · 沉淀记忆', gates: ['learned'] },
  ]
  const activeStepByStage: Partial<Record<OperatorMissionStage, string>> = {
    intake: 'understand',
    new: 'understand',
    understanding: 'understand',
    understanding_ready: 'understand',
    brainstorming: 'understand',
    clarifying: 'understand',
    roadmap_ready: 'understand',
    pending_approval: 'roadmap',
    approved: 'roadmap',
    running: 'execute',
    evidence_ready: 'execute',
    validating: 'validate',
    validators_missing: 'validate',
    validators_ready: 'validate',
    pr_ready: 'pr-gate',
    pr_blocked: 'pr-gate',
    pr_created: 'pr-gate',
    learned: 'learn',
    failed: 'execute',
    cancelled: 'execute',
  }
  const activeStepId = activeStepByStage[opts.stage] ?? 'understand'
  const currentIndex = stages.findIndex((s) => s.id === activeStepId)
  const progress = stages.map((step, index) => ({
    id: step.id,
    label: step.label,
    status: opts.stage === 'failed' || opts.stage === 'cancelled'
      ? (index <= Math.max(currentIndex, 0) ? 'blocked' as const : 'pending' as const)
      : index < currentIndex ? 'done' as const : index === currentIndex ? 'active' as const : 'pending' as const,
    detail: step.id === 'validate' && opts.validatorStatus === 'not_configured'
      ? 'Gemini key is not configured; this is visible and not counted as pass.'
      : undefined,
  }))
  const touchedFiles = extractTouchedFiles(opts.artifacts, opts.events)
  const checkedEvidence = opts.artifacts.map((a) => a.title ?? a.path).slice(0, 8)
  const validatorReviews = opts.validators.length
    ? opts.validators.map((v) => ({
        id: v.id,
        validator: v.validator,
        verdict: v.verdict,
        summary: v.summary ?? 'Validator returned a verdict from evidence only.',
        checkedEvidence,
        blockingIssues: v.verdict.toLowerCase() === 'fail' ? [v.summary ?? 'Validator reported a failing verdict.'] : [],
        evidenceGaps: /inconclusive|needs_human/i.test(v.verdict) ? [v.summary ?? 'Validator could not prove the result from available evidence.'] : [],
        recommendedNextAction: v.verdict.toLowerCase() === 'pass'
          ? 'Proceed to the PR gate if the operator accepts the evidence.'
          : 'Review evidence gaps, repair the worker output, then rerun validation.',
      }))
    : [{
        id: 'validators-not-configured',
        validator: 'validators',
        verdict: opts.validatorStatus === 'not_configured' ? 'not_configured' : 'pending',
        summary: opts.validatorStatus === 'not_configured'
          ? 'Independent validation did not run because the Gemini key is not configured.'
          : 'Independent validation has not produced a verdict yet.',
        checkedEvidence,
        blockingIssues: [],
        evidenceGaps: opts.validatorStatus === 'not_configured' ? ['No Gemini validator verdict exists for this mission.'] : [],
        recommendedNextAction: opts.validatorStatus === 'not_configured'
          ? 'Configure validator keys for live verification, or continue reviewing evidence manually.'
          : 'Wait for validators, or inspect worker evidence if validation stalls.',
      }]
  return {
    progress,
    ...(opts.latestRun?.evidenceDir ? { workingFolder: opts.latestRun.evidenceDir } : opts.repo?.path ? { workingFolder: opts.repo.path } : {}),
    touchedFiles,
    evidence: opts.artifacts.map((a) => ({ id: a.id, title: a.title ?? a.path, path: a.path, type: a.type })),
    validatorReviews,
  }
}

function extractTouchedFiles(
  artifacts: Array<MissionArtifact & { preview?: string | null }>,
  events: Array<{ payload: Record<string, unknown> }>,
): string[] {
  const files = new Set<string>()
  for (const artifact of artifacts) {
    const isChangedPaths = /(^|\/)changed-paths\.json$/.test(artifact.path) || artifact.title === 'Changed paths'
    if (!isChangedPaths) continue
    const raw = artifact.preview ?? readArtifactPreview(artifact.path)
    if (!raw) continue
    try {
      const parsed = JSON.parse(raw) as { changedPaths?: unknown }
      if (Array.isArray(parsed.changedPaths)) {
        for (const path of parsed.changedPaths) {
          if (typeof path === 'string' && path.trim()) files.add(path.trim())
        }
      }
    } catch {
      // Keep Project Pulse resilient: malformed evidence remains visible as an
      // artifact; it just does not become a touched-file list.
    }
  }
  for (const event of events) {
    const changed = event.payload['changedPaths']
    if (Array.isArray(changed)) {
      for (const path of changed) {
        if (typeof path === 'string' && path.trim()) files.add(path.trim())
      }
    }
  }
  return [...files]
}

function buildMemorySummary(opts: {
  repo?: { id: string; name: string; path: string; testCommands?: string[]; forbiddenPaths?: string[] } | undefined
  session?: { id: string; prompt: string } | undefined
  events: Array<{ id: string; type: string; payload: Record<string, unknown>; createdAt?: string }>
}): OperatorMissionView['memorySummary'] {
  const repo = opts.repo
  const projectFacts = [
    repo ? {
      id: `repo-${repo.id}`,
      kind: 'project',
      text: `Target repo is ${repo.name} at ${repo.path}.`,
      provenance: 'repo registry',
      ttlDays: 90,
      superseded: false,
    } : null,
    repo?.testCommands?.length ? {
      id: `repo-tests-${repo.id}`,
      kind: 'project',
      text: `Known test commands: ${repo.testCommands.join(', ')}`,
      provenance: 'repo registry',
      ttlDays: 90,
      superseded: false,
    } : null,
    repo?.forbiddenPaths?.length ? {
      id: `repo-forbidden-${repo.id}`,
      kind: 'safety',
      text: `Forbidden paths stay protected: ${repo.forbiddenPaths.join(', ')}`,
      provenance: 'repo policy',
      ttlDays: 365,
      superseded: false,
    } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null)
  const userPreferences = [
    {
      id: 'pref-understand-first',
      kind: 'user_preference',
      text: 'Ask goal-specific questions and confirm understanding before starting worker execution.',
      provenance: 'operator product directive',
      ttlDays: 365,
      superseded: false,
    },
    opts.session ? {
      id: `prompt-${opts.session.id}`,
      kind: 'mission_intent',
      text: `Current mission intent: ${opts.session.prompt.slice(0, 240)}`,
      provenance: 'operator prompt',
      ttlDays: 30,
      superseded: false,
    } : null,
  ].filter((x): x is NonNullable<typeof x> => x !== null)
  const recentLessons = opts.events
    .filter((e) => e.type === 'operator.validator_result' || e.type === 'operator.draft_pr_blocked' || e.type === 'operator.worker_failed')
    .slice(0, 3)
    .map((e) => ({
      id: `lesson-${e.id}`,
      kind: 'run_lesson',
      text: readableStatus(e.type) + (typeof e.payload['code'] === 'string' ? `: ${e.payload['code']}` : ''),
      provenance: `event:${e.type}`,
      ttlDays: 30,
      superseded: false,
    }))
  return { projectFacts, userPreferences, recentLessons }
}

function buildOperatorMissionView(opts: {
  db: AedevDb
  mission: { status: string; githubPrUrl?: string | null }
  repo?: { id: string; name: string; path: string; testCommands?: string[]; forbiddenPaths?: string[] } | undefined
  session?: { status: string; prompt?: string } | undefined
  sessionId?: string | undefined
  latestRun?: Run
  runs: Run[]
  validators: ValidatorResult[]
  validatorSecretStatus: ReturnType<typeof inspectDefaultMissionValidatorSecrets>
  validatorStatus: string
  artifacts: Array<MissionArtifact & { preview?: string | null }>
  events: Array<{ type: string; entityType?: string; payload: Record<string, unknown> }>
  cost: ReturnType<typeof summarizeCost>
  remoteWrites: 'enabled' | 'disabled'
}): OperatorMissionView {
  const stage = inferOperatorStage({
    mission: opts.mission,
    session: opts.session,
    runs: opts.runs,
    validators: opts.validators,
    validatorStatus: opts.validatorStatus,
    events: opts.events.map((e) => ({ type: e.type, payload: e.payload })),
  })
  const blocked = opts.events.find((e) => e.type === 'operator.draft_pr_blocked')
  const prGate = opts.mission.githubPrUrl
    ? { status: 'created' as const, reason: 'Draft PR URL is recorded on the mission.' }
    : blocked
      ? {
          status: 'blocked' as const,
          code: typeof blocked.payload['code'] === 'string' ? blocked.payload['code'] : undefined,
          reason: typeof blocked.payload['reason'] === 'string' ? blocked.payload['reason'] : undefined,
          remediation: prGateRemediation(typeof blocked.payload['code'] === 'string' ? blocked.payload['code'] : undefined),
        }
      : stageProgress(stage) >= 78
        ? { status: 'ready' as const, reason: 'Evidence is ready; checking the gate will either create a Draft PR or explain the safety block.' }
        : undefined
  const testMode = operatorForceMock() || isTemplateRoadmapEnabled()
  const stageLabel = labelForOperatorStage(stage)
  const questions = latestPendingQuestions(opts.db, opts.sessionId)
  const understanding = buildUnderstandingSummary(opts.db, opts.sessionId, stage, questions)
  return {
    stage,
    stageLabel,
    confidence: understanding.confidence,
    progressPercent: stageProgress(stage),
    headlessCallsToday: countHeadlessCallsToday(opts.db),
    primaryAction: primaryActionForStage(stage),
    secondaryActions: stage === 'running'
      ? [
          { id: 'pause', label: 'Pause · 暂停', kind: 'secondary' },
          { id: 'start-over', label: 'Stop · 停止', kind: 'secondary' },
        ]
      : [],
    providerSummary: buildProviderSummary(opts.latestRun, opts.validators, opts.validatorStatus, opts.validatorSecretStatus, opts.cost, opts.events),
    safetySummary: {
      remoteWrites: opts.remoteWrites,
      ...(prGate ? { prGate } : {}),
      ...(testMode ? { testMode: { enabled: true, reason: 'mock/template mode is active; no external model or remote write is implied.' } } : {}),
    },
    understanding: understanding.understanding,
    projectPulse: buildProjectPulse({
      stage,
      repo: opts.repo,
      latestRun: opts.latestRun,
      artifacts: opts.artifacts,
      validators: opts.validators,
      validatorStatus: opts.validatorStatus,
      events: opts.events.map((e, index) => ({ id: String(index), type: e.type, payload: e.payload })),
    }),
    memorySummary: buildMemorySummary({
      repo: opts.repo,
      session: opts.sessionId ? { id: opts.sessionId, prompt: opts.session?.prompt ?? '' } : undefined,
      events: opts.events.map((e, index) => ({ id: String(index), type: e.type, payload: e.payload })),
    }),
    summary: summaryForStage(stage, opts.validatorStatus, opts.remoteWrites),
    nextAction: nextActionForStage(stage, opts.remoteWrites),
    testMode,
  }
}

function summaryForStage(stage: OperatorMissionStage, validatorStatus: string, remoteWrites: 'enabled' | 'disabled'): string {
  if (stage === 'understanding') return 'The local planner is reading your goal and preparing repo-specific clarification. No worker has started.'
  if (stage === 'understanding_ready') return 'The system has enough initial context to draft a roadmap. You can continue clarifying or generate the plan.'
  if (stage === 'validators_missing') return 'Worker execution is complete and evidence is ready. Gemini did not run because its key is not configured; this is not counted as a pass.'
  if (stage === 'pr_blocked') return 'Worker done, evidence ready, and the Draft PR gate was blocked by policy. No branch push, PR, or merge occurred.'
  if (stage === 'evidence_ready') return remoteWrites === 'disabled'
    ? 'Evidence is ready. You can check the Draft PR gate; current policy will block remote writes.'
    : 'Evidence is ready. You can check the Draft PR gate to open a policy-gated draft PR.'
  if (stage === 'running') return 'A worker is executing. Watch the timeline, logs, provider mode, tokens, and evidence updates.'
  if (stage === 'pending_approval') return 'The plan is generated and waiting for your approval before any worker can run.'
  if (stage === 'roadmap_ready') return 'The brainstorm is ready. Generate the PRD/ADR/Roadmap when the direction is correct.'
  if (stage === 'approved') return 'The roadmap is approved. Starting execution will assign a worker.'
  if (stage === 'failed') return 'Execution failed. Inspect evidence and logs, then start over with a narrower mission or corrected setup.'
  if (stage === 'cancelled') return 'The mission is cancelled. Background results are ignored.'
  if (validatorStatus === 'not_configured') return 'Validators are not configured yet; the UI will show this honestly instead of marking validation as passed.'
  return 'The mission is progressing through the cockpit workflow.'
}

function nextActionForStage(stage: OperatorMissionStage, remoteWrites: 'enabled' | 'disabled'): string {
  if (stage === 'pr_blocked') return 'Continue reviewing evidence, or explicitly enable repo-scoped remote writes before re-checking the gate.'
  if (stage === 'validators_missing') return 'Review evidence, then check the PR safety gate; validators can be configured later for a stronger live run.'
  if (stage === 'evidence_ready') return remoteWrites === 'disabled' ? 'Check the PR gate to confirm the safe block.' : 'Check the PR gate to create a draft PR.'
  if (stage === 'pending_approval') return 'Approve the roadmap only if the plan matches your intent.'
  if (stage === 'approved') return 'Start execution when you are ready for a worker to run.'
  if (stage === 'understanding') return 'Answer the planner questions when they appear; the worker cannot run yet.'
  if (stage === 'understanding_ready') return 'Generate the plan, or ask one more round of questions first.'
  if (stage === 'roadmap_ready') return 'Generate the plan, or add more constraints first.'
  if (stage === 'running') return 'Wait for progress, pause, or stop if the run is wrong.'
  return 'Continue the next visible cockpit action.'
}

function buildMissionOverview(db: AedevDb, missionId: string, stateDir: string = resolveStateDirSafe()) {
  const mission = db.getMission(missionId)
  if (!mission) return null
  const tasks = db.listTasks(mission.id)
  const runs = tasks.flatMap((t) => db.listRuns(t.id))
  const validators = tasks.flatMap((t) => db.listValidatorResults(t.id))
  const artifacts = db.listMissionArtifacts(mission.id).map((artifact) => ({
    ...artifact,
    preview: readArtifactPreview(artifact.path),
  }))
  const session = db.listOperatorSessions().find((s) => s.missionId === mission.id)
  const repo = db.getRepo(mission.repoId)
  const missionEvents = db.queryEvents({ entityId: mission.id, limit: 50 })
  const sessionEvents = session ? db.queryEvents({ entityId: session.id, limit: 50 }) : []
  const events = [...missionEvents, ...sessionEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80)
  const latestRun = runs[0]
  const latestEvidence = latestRun?.evidenceDir
  const cost = summarizeCost(runs, validators, events)
  const validatorSecretStatus = inspectDefaultMissionValidatorSecrets({ missionId: mission.id, taskId: `overview-${mission.id}` })
  const validatorsConfigured =
    validatorSecretStatus.configuredCount > 0 &&
    db.queryEvents({ type: 'operator.validators_not_configured', entityId: mission.id, limit: 1 }).length === 0
  const validatorStatus = validators.length > 0 ? 'complete' : validatorsConfigured ? 'pending' : 'not_configured'
  // Active blockers (table-backed) are shown prominently; historical holds stay in `holds` (events).
  const activeHolds = [...db.listActiveHolds(mission.id), ...(session ? db.listActiveHolds(session.id) : [])]
  const runProgress = computeRunProgress(latestRun, events)
  const remoteWrites = allowRemoteWritesEnabled(stateDir) ? 'enabled' : 'disabled'
  const operatorView = buildOperatorMissionView({
    db,
    mission,
    repo,
    session,
    sessionId: session?.id,
    latestRun,
    runs,
    validators,
    validatorSecretStatus,
    validatorStatus,
    artifacts,
    events,
    cost,
    remoteWrites,
  })
  return {
    mission,
    stage: inferStage(mission.status, tasks, runs, validators),
    stages: stageList(inferStage(mission.status, tasks, runs, validators)),
    operatorView,
    tasks,
    runs,
    validators,
    artifacts,
    events,
    approvals: db.listApprovals().filter((a) => a.entityId === mission.id),
    activeAgents: inferAgents(tasks, validators),
    cliProvider: latestRun?.runnerMode ?? 'subscription-pool',
    progress: inferProgress(mission.status, tasks, validators),
    holds: events.filter((e) => /hold|held/i.test(e.type)),
    activeHolds,
    runProgress,
    evidenceDir: latestEvidence,
    cost,
    validatorStatus,
    validatorNote: validatorStatus === 'not_configured'
      ? 'Gemini validator key is not configured. The system will not treat missing validation as a pass.'
      : null,
  }
}

function resolveStateDirSafe(): string {
  return join(process.env['AEDEV_HOME'] ?? join(process.env['HOME'] ?? '', '.aedev'), 'state')
}

function stageList(current: Stage) {
  const stages: Stage[] = ['Intake', 'Brainstorm', 'PRD', 'ADR', 'Roadmap', 'Approved', 'Worker', 'Tests', 'Validators', 'PR/Waiting/Blocked']
  const index = stages.indexOf(current)
  return stages.map((stage, i) => ({ stage, status: i < index ? 'done' : i === index ? 'active' : 'pending' }))
}

function inferStage(status: string, tasks: Task[], runs: Run[], validators: ValidatorResult[]): Stage {
  if (['done', 'failed', 'paused', 'cancelled'].includes(status)) return 'PR/Waiting/Blocked'
  if (validators.length > 0) return 'Validators'
  if (runs.some((r) => r.status === 'done')) return 'Tests'
  if (tasks.some((t) => t.status === 'running' || t.status === 'done')) return 'Worker'
  if (status === 'approved') return 'Approved'
  if (status === 'pending_approval') return 'Roadmap'
  if (status === 'draft') return 'Roadmap'
  return 'Intake'
}

function inferProgress(status: string, tasks: Task[], validators: ValidatorResult[]): number {
  if (status === 'done') return 1
  if (['failed', 'paused', 'cancelled'].includes(status)) return 0.8
  if (validators.length > 0) return 0.75
  if (tasks.some((t) => t.status === 'done')) return 0.65
  if (tasks.some((t) => t.status === 'running')) return 0.5
  if (status === 'approved') return 0.4
  if (status === 'pending_approval') return 0.3
  return 0.15
}

function inferAgents(tasks: Task[], validators: ValidatorResult[]): string[] {
  const agents = ['planner', 'architect', 'builder', 'reviewer']
  if (tasks.some((t) => t.status === 'running' || t.status === 'done')) agents.push('coder')
  for (const v of validators) agents.push(`${v.validator}-validator`)
  return agents
}

function summarizeCost(runs: Run[], validators: ValidatorResult[], events: Array<{ type?: string; entityType?: string; payload: Record<string, unknown> }>) {
  const usage = events
    .filter((e) => typeof e.payload?.['inputTokens'] === 'number' || typeof e.payload?.['outputTokens'] === 'number')
  const plannerUsage = usage.filter((e) => e.payload['scope'] === 'planner' || e.entityType === 'operator_session').map((e) => e.payload)
  const workerUsage = usage.filter((e) => e.payload['scope'] !== 'planner' && e.entityType !== 'operator_session').map((e) => e.payload)
  const allUsage = usage.map((e) => e.payload)
  const inputTokens = allUsage.reduce((sum, u) => sum + Number(u['inputTokens'] ?? 0), 0)
  const outputTokens = allUsage.reduce((sum, u) => sum + Number(u['outputTokens'] ?? 0), 0)
  const costs = allUsage.map((u) => u['costUsd']).filter((v): v is number => typeof v === 'number')
  const plannerTokens = sumTokens(plannerUsage)
  const workerTokens = sumTokens(workerUsage)
  return {
    mode: 'subscription_mode_usage',
    scope: 'planner_and_worker',
    runCount: runs.length,
    validatorCount: validators.length,
    plannerTokens,
    workerTokens,
    totalTokens: allUsage.length ? inputTokens + outputTokens : null,
    inputTokens: allUsage.length ? inputTokens : null,
    outputTokens: allUsage.length ? outputTokens : null,
    costUsd: costs.length ? costs.reduce((sum, v) => sum + v, 0) : null,
    note: allUsage.length
      ? 'Planner and worker token usage is aggregated when provider data is available. Subscription cost remains unknown unless the provider reports actual cost.'
      : 'Exact local CLI token/cost is shown only when provider usage is available.',
    updatedAt: nowIso(),
  }
}

function sumTokens(usages: Array<Record<string, unknown>>) {
  if (usages.length === 0) return null
  return usages.reduce((sum, u) => sum + Number(u['inputTokens'] ?? 0) + Number(u['outputTokens'] ?? 0), 0)
}

function readArtifactPreview(path: string): string | null {
  try {
    if (!existsSync(path) || !statSync(path).isFile()) return null
    return readFileSync(path, 'utf8').slice(0, 8000)
  } catch {
    return null
  }
}

export { buildMissionOverview }
