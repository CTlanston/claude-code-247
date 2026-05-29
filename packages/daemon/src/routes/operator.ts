import { appendFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { FastifyInstance } from 'fastify'
import type { AedevDb, MissionArtifact, MissionDesign, OperatorChoice, Run, Task, ValidatorResult } from '@aedev/core'
import { nowIso, validateMissionDesign } from '@aedev/core'
import { ClaudeCodeAdapter, CodexCliAdapter, discoverWorkerSessions } from '@aedev/runner'
import { GeminiValidator, OpenAIValidator, MockValidator } from '@aedev/validators'
import { IntakeService } from '../intake.js'
import { MissionRunner } from '../mission-runner.js'
import { RolePipeline } from '../roles/role-pipeline.js'
import { DraftPrGate, DraftPrGateError } from '../draft-pr-gate.js'

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

interface OperatorSessionBody {
  repoId?: string
  title?: string
  prompt?: string
}

export function registerOperatorRoutes(app: FastifyInstance, db: AedevDb, stateDir: string): void {
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
    })
    db.insertEvent('operator.session.created', 'operator_session', session.id, { repoId })
    const brainstormPromise = completePlannerBrainstorm(db, session.id, prompt, title, repoId)
    if (process.env['VITEST'] || process.env['NODE_ENV'] === 'test') {
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
    const requestPrompt = req.body.prompt?.trim() || '请先不要执行。请向我提出 3 个必须确认的问题，并给出每个问题的推荐选项。'
    const repoId = ensureOperatorRepo(db, session.repoId)
    db.insertOperatorMessage({ sessionId: session.id, role: 'user', content: requestPrompt })
    db.insertEvent('operator.message.added', 'operator_session', session.id, { role: 'user' })
    db.insertOperatorMessage({
      sessionId: session.id,
      role: 'assistant',
      content: 'Planner is preparing clarifying questions. · AI 正在准备需要你确认的问题，稍后会自动更新。',
    })
    db.updateOperatorSession(session.id, { status: 'brainstorming' })
    const followupPromise = completePlannerFollowup(db, session.id, requestPrompt, session.title, repoId, session.prompt)
    if (process.env['VITEST'] || process.env['NODE_ENV'] === 'test') {
      await followupPromise
    } else {
      void followupPromise
    }
    return { session: db.getOperatorSession(session.id), messages: db.listOperatorMessages(session.id) }
  })

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/generate-roadmap', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session) return reply.code(404).send({ error: 'session not found' })
    const repoId = ensureOperatorRepo(db, session.repoId)
    db.insertEvent('operator.roadmap_generation_started', 'operator_session', session.id, { repoId })
    const generated = await generateRoadmapDesign(db, stateDir, intake, repoId, session)
    if (!generated.ok) {
      db.updateOperatorSession(session.id, { status: 'hold' })
      db.insertOperatorMessage({ sessionId: session.id, role: 'assistant', content: generated.message })
      db.insertEvent('operator.hold_created', 'operator_session', session.id, {
        holdCode: 'HOLD-ROADMAP-PLANNER',
        reason: generated.reason,
      })
      return {
        session: db.getOperatorSession(session.id),
        messages: db.listOperatorMessages(session.id),
        hold: { code: 'HOLD-ROADMAP-PLANNER', reason: generated.reason },
      }
    }
    const mission = intake.requestApproval(generated.mission.id)
    db.updateOperatorSession(session.id, { missionId: mission.id, status: 'roadmap_ready' })
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
      return { session: db.getOperatorSession(session.id), mission: approved, overview: buildMissionOverview(db, approved.id) }
    } catch (e) {
      return reply.code(400).send({ error: (e as Error).message })
    }
  })

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/start', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session?.missionId) return reply.code(404).send({ error: 'session or mission not found' })
    const mission = db.getMission(session.missionId)
    if (!mission) return reply.code(404).send({ error: 'mission not found' })
    if (mission.status !== 'approved') return reply.code(400).send({ error: 'roadmap must be approved before execution' })
    try {
      db.updateOperatorSession(session.id, { status: 'running' })
      db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'Worker', sessionId: session.id })
      const runPromise = runOperatorMission(db, stateDir, session.id, mission.id)
      if (process.env['VITEST']) {
        const result = await runPromise
        return { session: db.getOperatorSession(session.id), result, overview: buildMissionOverview(db, mission.id) }
      }
      void runPromise.catch((e) => {
        db.updateOperatorSession(session.id, { status: 'failed' })
        db.updateMissionStatus(mission.id, 'failed')
        db.insertEvent('operator.worker_failed', 'mission', mission.id, { sessionId: session.id, error: (e as Error).message })
      })
      return {
        session: db.getOperatorSession(session.id),
        result: { status: 'running', mergeDecision: 'WAITING' },
        overview: buildMissionOverview(db, mission.id),
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
    const overview = buildMissionOverview(db, mission.id)
    if (!overview?.evidenceDir) return reply.code(400).send({ error: 'mission has not reached evidence gate' })
    if (approvals.length === 0) return reply.code(400).send({ error: 'operator approval is required before draft PR creation' })
    const gate = new DraftPrGate(
      { allowRemoteWrites: allowRemoteWritesEnabled(stateDir) },
      {
        async pushBranch() {
          if (!isFakePrEnabled()) throw new Error('real git push adapter is not configured for Operator Cockpit')
        },
      },
      {
        async createDraftPr(req) {
          if (!isFakePrEnabled()) throw new Error('real draft PR adapter is not configured for Operator Cockpit')
          return { number: 247, url: `https://example.invalid/${req.repo.name}/pull/247`, state: 'open', draft: true as const }
        },
      },
    )
    try {
      const info = await gate.openDraftPr({
        repo,
        missionId: mission.id,
        title: mission.title,
        branch: `operator/${mission.id.slice(0, 8)}`,
        base: repo.defaultBranch,
        changedPaths: [],
        evidenceUri: overview.evidenceDir,
        riskScore: 0,
        validatorResults: overview.validators,
        rollbackNotes: 'Close the draft PR; no merge was performed by Operator Cockpit.',
      })
      db.updateMissionGitHub(mission.id, { githubBranch: `operator/${mission.id.slice(0, 8)}`, githubPrUrl: info.url, githubPrNumber: info.number })
      db.insertEvent('operator.draft_pr_created', 'mission', mission.id, { url: info.url, number: info.number })
      return { status: 'created', pr: info, overview: buildMissionOverview(db, mission.id) }
    } catch (e) {
      const code = e instanceof DraftPrGateError ? e.code : 'DRAFT_PR_NOT_CONFIGURED'
      const reason = (e as Error).message
      db.insertEvent('operator.draft_pr_blocked', 'mission', mission.id, { code, reason })
      return { status: 'blocked', code, reason, overview: buildMissionOverview(db, mission.id) }
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
    return { session: db.getOperatorSession(session.id), overview: buildMissionOverview(db, mission.id) }
  })

  app.post<{ Params: { id: string } }>('/operator/sessions/:id/resume', async (req, reply) => {
    const session = db.getOperatorSession(req.params.id)
    if (!session?.missionId) return reply.code(404).send({ error: 'session or mission not found' })
    const mission = db.getMission(session.missionId)
    if (!mission) return reply.code(404).send({ error: 'mission not found' })
    db.updateOperatorSession(session.id, { status: 'approved' })
    db.updateMissionStatus(mission.id, 'approved')
    db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'Approved', sessionId: session.id, status: 'approved' })
    return { session: db.getOperatorSession(session.id), overview: buildMissionOverview(db, mission.id) }
  })

  app.get<{ Params: { id: string } }>('/missions/:id/overview', async (req, reply) => {
    const overview = buildMissionOverview(db, req.params.id)
    if (!overview) return reply.code(404).send({ error: 'mission not found' })
    return overview
  })

  app.get<{ Params: { id: string; runId: string } }>('/missions/:id/runs/:runId/log', async (req, reply) => {
    const overview = buildMissionOverview(db, req.params.id)
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
      label: '先问我 3 个问题',
      labelEn: 'Ask me 3 questions first',
      action: 'ask-questions',
      prompt: '请先不要执行。请向我提出 3 个必须确认的问题，并给出每个问题的推荐选项。',
    },
    { id: 'add-constraints', label: '补充约束', labelEn: 'Add constraints', action: 'add-constraints' },
  ]
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

async function completePlannerBrainstorm(
  db: AedevDb,
  sessionId: string,
  prompt: string,
  title: string,
  repoId: string,
): Promise<void> {
  try {
    db.insertEvent('operator.role_started', 'operator_session', sessionId, { role: 'planner', provider: process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'auto' })
    const brainstorm = await runPlannerBrainstorm(prompt, title, repoId)
    const isHold = Boolean(brainstorm.event['holdCode'])
    db.insertOperatorMessage({
      sessionId,
      role: 'assistant',
      content: brainstorm.content,
      ...(isHold ? {} : { choices: brainstormChoices() }),
    })
    db.updateOperatorSession(sessionId, { status: isHold ? 'hold' : 'brainstorm_ready' })
    db.insertEvent('operator.role_done', 'operator_session', sessionId, brainstorm.event)
    if (typeof brainstorm.event['inputTokens'] === 'number' || typeof brainstorm.event['outputTokens'] === 'number') {
      db.insertEvent('operator.cost_updated', 'operator_session', sessionId, {
        scope: 'planner_brainstorm',
        provider: brainstorm.event['provider'],
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
  }
}

async function runPlannerBrainstorm(prompt: string, title: string, repoId: string): Promise<{ content: string; event: Record<string, unknown> }> {
  if (process.env['VITEST'] || process.env['NODE_ENV'] === 'test' || isTemplateRoadmapEnabled()) {
    return {
      content: renderBrainstorm(prompt),
      event: { role: 'planner', provider: 'test-synthetic', repoId },
    }
  }

  const systemPrompt = [
    'You are the Claude Code 24/7 lead planner and product copilot.',
    'Produce concrete brainstorm options, risks, a recommended roadmap, approval questions, and observable execution checkpoints.',
    'You must include an "Operator Questions" section with 3 numbered choices the operator can pick from before execution.',
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
    'Do not claim code was changed. This is planning only.',
  ].join('\n')
  return runLocalPlannerText(systemPrompt, plannerPrompt, 'planner', prompt)
}

async function runPlannerFollowup(requestPrompt: string, title: string, repoId: string, originalPrompt: string): Promise<{ content: string; event: Record<string, unknown> }> {
  if (process.env['VITEST'] || process.env['NODE_ENV'] === 'test' || isTemplateRoadmapEnabled()) {
    return {
      content: renderFollowupQuestions(originalPrompt),
      event: { role: 'planner-followup', provider: 'test-synthetic', repoId },
    }
  }

  const systemPrompt = [
    'You are the Claude Code 24/7 lead planner.',
    'The operator asked you to slow down and ask clarifying questions before any execution or roadmap generation.',
    'Reply with an "Operator Questions" section containing exactly 3 numbered clarifying questions; for each give a recommended default option.',
    'Do not generate a roadmap yet and do not claim any code changed. Write bilingual (Chinese + English) when the user writes Chinese.',
  ].join(' ')
  const plannerPrompt = [
    `Mission title: ${title}`,
    `Repo id: ${repoId}`,
    '',
    'Original request:',
    originalPrompt,
    '',
    'Operator follow-up request:',
    requestPrompt,
    '',
    'Return an "Operator Questions" section with 3 numbered questions, each with a recommended option. Planning only.',
  ].join('\n')
  return runLocalPlannerText(systemPrompt, plannerPrompt, 'planner-followup', requestPrompt)
}

async function runLocalPlannerText(systemPrompt: string, plannerPrompt: string, role: string, holdContextPrompt: string): Promise<{ content: string; event: Record<string, unknown> }> {
  const timeoutMs = Number(process.env['AEDEV_COCKPIT_AI_TIMEOUT_MS'] ?? '120000')
  const failures: string[] = []
  const plannerProvider = process.env['AEDEV_COCKPIT_PLANNER_PROVIDER']

  const claude = new ClaudeCodeAdapter()
  if (plannerProvider !== 'codex' && await claude.isAvailable()) {
    const result = await claude.run(plannerPrompt, process.cwd(), {
      systemPrompt,
      permissionMode: 'bypassPermissions',
      timeoutMs,
    })
    if (result.exitCode === 0 && result.transcript.trim()) {
      return {
        content: result.transcript.trim(),
        event: { role, provider: 'claude-cli', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd },
      }
    }
    failures.push(`claude-cli: ${result.error ?? `exit ${result.exitCode}`}`)
  }

  const codex = new CodexCliAdapter()
  if (plannerProvider !== 'claude' && await codex.isAvailable()) {
    const result = await codex.run(`${systemPrompt}\n\n${plannerPrompt}`, process.cwd(), {
      sandbox: 'read-only',
      approvalPolicy: 'never',
      timeoutMs,
    })
    if (result.exitCode === 0 && result.transcript.trim()) {
      return {
        content: result.transcript.trim(),
        event: { role, provider: 'codex-cli', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd },
      }
    }
    failures.push(`codex-cli: ${result.error ?? `exit ${result.exitCode}`}`)
  }

  return {
    content: renderPlannerHold('local planner', failures.length ? failures.join('; ') : 'No healthy Claude or Codex CLI was found on PATH.', holdContextPrompt),
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
  sessionId: string,
  requestPrompt: string,
  title: string,
  repoId: string,
  originalPrompt: string,
): Promise<void> {
  try {
    db.insertEvent('operator.role_started', 'operator_session', sessionId, { role: 'planner-followup', provider: process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'auto' })
    const followup = await runPlannerFollowup(requestPrompt, title, repoId, originalPrompt)
    const isHold = Boolean(followup.event['holdCode'])
    db.insertOperatorMessage({
      sessionId,
      role: 'assistant',
      content: followup.content,
      ...(isHold ? {} : { choices: brainstormChoices() }),
    })
    db.updateOperatorSession(sessionId, { status: isHold ? 'hold' : 'brainstorm_ready' })
    db.insertEvent('operator.role_done', 'operator_session', sessionId, followup.event)
    if (typeof followup.event['inputTokens'] === 'number' || typeof followup.event['outputTokens'] === 'number') {
      db.insertEvent('operator.cost_updated', 'operator_session', sessionId, {
        scope: 'planner_followup',
        provider: followup.event['provider'],
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
  return db.insertRepo({
    name: 'local-workspace',
    path: process.cwd(),
    defaultBranch: 'main',
    enabled: true,
    testCommands: [],
    forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    riskRules: {},
    mergePolicy: 'WAITING',
  }).id
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

  const output = await runPlannerMissionDesign(session.prompt, session.title, repoId, mission.id)
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
    db.insertEvent('operator.cost_updated', 'operator_session', session.id, {
      scope: 'planner',
      provider: output.provider,
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

async function runPlannerMissionDesign(
  prompt: string,
  title: string,
  repoId: string,
  missionId: string,
): Promise<{
  ok: true
  design: unknown
  provider: string
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
    '',
    'Design a low-risk evidence-gated mission. The taskDag must contain at least one coder task and expected evidence files.',
  ].join('\n')
  const timeoutMs = Number(process.env['AEDEV_COCKPIT_AI_TIMEOUT_MS'] ?? '120000')
  const provider = process.env['AEDEV_COCKPIT_PLANNER_PROVIDER']
  const failures: string[] = []

  const claude = new ClaudeCodeAdapter()
  if (provider !== 'codex' && await claude.isAvailable()) {
    const result = await claude.run(plannerPrompt, process.cwd(), { timeoutMs, permissionMode: 'bypassPermissions' })
    if (result.exitCode === 0 && result.transcript.trim()) {
      const parsed = extractJsonObject(result.transcript)
      if (parsed.ok) return { ok: true, design: parsed.value, provider: 'claude-cli', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd }
      failures.push(`claude-cli invalid JSON: ${parsed.reason}`)
    } else {
      failures.push(`claude-cli: ${result.error ?? `exit ${result.exitCode}`}`)
    }
  }

  const codex = new CodexCliAdapter()
  if (provider !== 'claude' && await codex.isAvailable()) {
    const result = await codex.run(plannerPrompt, process.cwd(), { timeoutMs, sandbox: 'read-only', approvalPolicy: 'never' })
    if (result.exitCode === 0 && result.transcript.trim()) {
      const parsed = extractJsonObject(result.transcript)
      if (parsed.ok) return { ok: true, design: parsed.value, provider: 'codex-cli', inputTokens: result.inputTokens, outputTokens: result.outputTokens, costUsd: result.costUsd }
      failures.push(`codex-cli invalid JSON: ${parsed.reason}`)
    } else {
      failures.push(`codex-cli: ${result.error ?? `exit ${result.exitCode}`}`)
    }
  }

  return { ok: false, reason: failures.length ? failures.join('; ') : 'No healthy local Claude or Codex planner CLI found.' }
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

function registerEvidenceArtifacts(db: AedevDb, missionId: string, evidenceDir: string): void {
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
  ]
  for (const [file, type, title] of known) {
    const path = join(evidenceDir, file)
    if (existsSync(path)) db.upsertMissionArtifact({ missionId, type, path, title })
  }
}

async function runOperatorMission(db: AedevDb, stateDir: string, sessionId: string, missionId: string) {
  const workerSessions = await discoverWorkerSessions()
  const forceMock = /^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_FORCE_MOCK'] ?? '') ||
    (Boolean(process.env['VITEST']) && process.env['AEDEV_COCKPIT_FORCE_REAL'] !== '1')
  const validators = buildCockpitValidators()
  if (validators.length === 0) {
    db.insertEvent('operator.validators_not_configured', 'mission', missionId, {
      status: 'not_configured',
      note: 'Gemini/OpenAI validator keys are not configured; merge remains WAITING/BLOCKED.',
    })
  }
  const runnerOpts = forceMock
    ? { runner: operatorDraftRunner(db, stateDir) }
    : { workerSessions, runner: operatorLocalCliRunner(db, stateDir, workerSessions, validators.length >= 2) }
  db.insertEvent('operator.worker_assigned', 'mission', missionId, {
    sessionId,
    mode: forceMock ? 'mock' : 'local-cli',
    availableSessions: workerSessions.length,
  })
  if (validators.length > 0) {
    db.insertEvent('operator.validator_started', 'mission', missionId, { sessionId, count: validators.length })
  }
  const result = await new MissionRunner(db, {
    stateDir,
    rolePipeline: new RolePipeline(),
    ...runnerOpts,
    validators,
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
  db.updateOperatorSession(sessionId, { status: result.status })
  db.insertEvent('operator.stage_changed', 'mission', missionId, { stage: 'PR/Waiting/Blocked', sessionId, status: result.status })
  return result
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

function buildCockpitValidators() {
  if (/^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_FAKE_VALIDATORS'] ?? '')) {
    return [new MockValidator('pass')]
  }
  const validators = []
  const geminiKey = process.env['AEDEV_GEMINI_API_KEY'] ?? process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY']
  if (geminiKey) validators.push(new GeminiValidator({ apiKey: geminiKey }))
  const openaiKey = process.env['AEDEV_OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY']
  if (openaiKey) validators.push(new OpenAIValidator({ apiKey: openaiKey }))
  return validators
}

function isTemplateRoadmapEnabled(): boolean {
  if (process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] !== undefined) {
    return /^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'])
  }
  return Boolean(process.env['VITEST'])
}

function isFakePrEnabled(): boolean {
  return /^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_FAKE_PR'] ?? '')
}

function allowRemoteWritesEnabled(stateDir: string): boolean {
  if (process.env['AEDEV_ALLOW_REMOTE_WRITES'] !== undefined) {
    return /^(1|true|yes)$/i.test(process.env['AEDEV_ALLOW_REMOTE_WRITES'])
  }
  const candidates = [
    join(stateDir, 'config.yaml'),
    join(process.env['HOME'] ?? '', '.aedev', 'config.yaml'),
    join(process.env['HOME'] ?? '', '.claude-code-247', 'config.yaml'),
    join(process.env['HOME'] ?? '', '.Codex-247', 'config.yaml'),
  ]
  return candidates.some((path) => {
    try {
      return existsSync(path) && /allow_remote_writes\s*:\s*true/i.test(readFileSync(path, 'utf8'))
    } catch {
      return false
    }
  })
}

function operatorLocalCliRunner(db: AedevDb, stateDir: string, sessions: Awaited<ReturnType<typeof discoverWorkerSessions>>, requireClaudeCoder = false) {
  return {
    async runTask(task: Task) {
      const session = requireClaudeCoder
        ? sessions.find((s) => s.healthy && s.provider === 'claude-cli')
        : sessions.find((s) => s.healthy && s.provider === 'codex-cli') ?? sessions.find((s) => s.healthy && s.provider === 'claude-cli')
      if (!session) throw new Error('HOLD-SESSION-POOL: no healthy Claude or Codex CLI session is available')
      const started = new Date().toISOString()
      const startedMs = Date.now()
      const evidenceDir = join(stateDir, 'operator-evidence', task.id)
      const workdir = join(stateDir, 'operator-workspaces', task.id)
      mkdirSync(evidenceDir, { recursive: true })
      mkdirSync(workdir, { recursive: true })
      writeFileSync(join(workdir, 'mission.md'), task.prompt)
      const logPath = join(evidenceDir, 'operator-run.log')
      writeFileSync(logPath, `[${nowIso()}] starting ${session.provider} worker for task ${task.id}\n`)
      const run = db.insertRun({
        taskId: task.id,
        runnerMode: session.provider === 'claude-cli' ? 'claude-cli' : 'codex-cli',
        status: 'running',
        startedAt: started,
        evidenceDir,
      })
      db.updateTaskStatus(task.id, 'running')
      db.insertEvent('operator.worker_started', 'mission', task.missionId, { taskId: task.id, runId: run.id, provider: session.provider, workdir, evidenceDir })
      const appendLog = (stream: 'stdout' | 'stderr', chunk: string) => {
        mkdirSync(evidenceDir, { recursive: true })
        appendFileSync(logPath, `[${nowIso()}] ${stream}: ${chunk}`)
        db.insertEvent('operator.worker_log', 'mission', task.missionId, { taskId: task.id, runId: run.id, stream, chunk: chunk.slice(0, 1200) })
      }

      const prompt = [
        task.prompt,
        '',
        'Run as an evidence-gate worker for the Operator Cockpit.',
        'Do not push to GitHub and do not edit secrets, .github, or AGENTS.md.',
        'Create or update files only inside the current temporary workspace if you need scratch files.',
        'Return a concise markdown report with: Plan, Concrete steps, Risks, Tests/checks, Done report.',
      ].join('\n')
      const timeoutMs = Number(process.env['AEDEV_COCKPIT_WORKER_TIMEOUT_MS'] ?? '180000')
      const result = session.provider === 'claude-cli'
        ? await new ClaudeCodeAdapter().run(prompt, workdir, { timeoutMs, onStdout: (chunk) => appendLog('stdout', chunk), onStderr: (chunk) => appendLog('stderr', chunk) })
        : await new CodexCliAdapter().run(prompt, workdir, { timeoutMs, sandbox: 'workspace-write', approvalPolicy: 'never', onStdout: (chunk) => appendLog('stdout', chunk), onStderr: (chunk) => appendLog('stderr', chunk) })
      const transcript = result.transcript || result.error || '(no transcript)'
      appendFileSync(logPath, `\n[${nowIso()}] completed exitCode=${result.exitCode}\n`)
      writeFileSync(join(evidenceDir, 'transcript-summary.md'), transcript)
      writeFileSync(join(evidenceDir, 'plan.md'), `# Plan\n\n${transcript}\n`)
      writeFileSync(join(evidenceDir, 'diff-summary.md'), '# Diff Summary\n\nOperator Cockpit local CLI worker used an isolated temporary workspace and did not push to GitHub.\n')
      writeFileSync(join(evidenceDir, 'test-summary.md'), `# Test Summary\n\nProvider: ${session.provider}\nExit code: ${result.exitCode}\n${result.error ? `Error: ${result.error}\n` : ''}`)
      writeFileSync(join(evidenceDir, 'done-report.md'), `# Done Report\n\nTask: ${task.id}\nProvider: ${session.provider}\nExit code: ${result.exitCode}\n`)
      writeFileSync(join(evidenceDir, 'model-usage.json'), JSON.stringify({
        provider: session.provider,
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
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        costUsd: result.costUsd,
      })
      db.insertEvent('operator.task_progress', 'task', task.id, { progress: 1, evidenceDir, provider: session.provider, exitCode: result.exitCode })
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

function buildMissionOverview(db: AedevDb, missionId: string) {
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
  const missionEvents = db.queryEvents({ entityId: mission.id, limit: 50 })
  const sessionEvents = session ? db.queryEvents({ entityId: session.id, limit: 50 }) : []
  const events = [...missionEvents, ...sessionEvents].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 80)
  const latestRun = runs[0]
  const latestEvidence = latestRun?.evidenceDir
  const cost = summarizeCost(runs, validators, events)
  const validatorsConfigured = db.queryEvents({ type: 'operator.validators_not_configured', entityId: mission.id, limit: 1 }).length === 0
  const validatorStatus = validators.length > 0 ? 'complete' : validatorsConfigured ? 'pending' : 'not_configured'
  return {
    mission,
    stage: inferStage(mission.status, tasks, runs, validators),
    stages: stageList(inferStage(mission.status, tasks, runs, validators)),
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
    evidenceDir: latestEvidence,
    cost,
    validatorStatus,
    validatorNote: validatorStatus === 'not_configured'
      ? 'Gemini/OpenAI validator keys are not configured. The system will not treat missing validators as a pass.'
      : null,
  }
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
