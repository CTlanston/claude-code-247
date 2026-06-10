import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'net'
import { execFileSync } from 'child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'
import { IntakeService } from './intake.js'

let db: AedevDb
let stateDir: string
beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-server-test-'))
  process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '1'
  process.env['AEDEV_COCKPIT_FORCE_MOCK'] = '1'
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
  delete process.env['AEDEV_COCKPIT_FORCE_TEMPLATE']
  delete process.env['AEDEV_COCKPIT_FORCE_MOCK']
})

describe('createServer', () => {
  it('GET /status returns 200 with expected shape', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ status: string; version: string }>()
    expect(body.status).toBe('running')
    expect(body.version).toBe('0.0.1')
  })

  it('GET /missions returns empty array initially', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/missions' })
    expect(res.statusCode).toBe(200)
    const body = res.json<{ missions: unknown[] }>()
    expect(body.missions).toEqual([])
  })

  it('GET /missions/:id returns 404 for unknown id', async () => {
    const app = createServer(db)
    const res = await app.inject({ method: 'GET', url: '/missions/nonexistent' })
    expect(res.statusCode).toBe(404)
  })

  it('GET /events/stream exists (listen + real fetch + abort)', async () => {
    const app = createServer(db)
    try {
      await app.listen({ port: 0, host: '127.0.0.1' })
    } catch (e) {
      expect(isListenPermissionError(e)).toBe(true)
      return
    }
    const port = (app.server.address() as AddressInfo).port
    const ac = new AbortController()
    setTimeout(() => ac.abort(), 80)
    try {
      const res = await fetch(`http://127.0.0.1:${port}/events/stream`, { signal: ac.signal })
      expect(res.headers.get('content-type')).toContain('text/event-stream')
    } catch (e) {
      if ((e as Error).name !== 'AbortError') throw e
    } finally {
      await app.close()
    }
  })

  it('serves the real L0 smoke route contract', async () => {
    const app = createServer(db, new Date(), stateDir)

    const health = await app.inject({ method: 'GET', url: '/health' })
    expect(health.statusCode).toBe(200)
    expect(health.json<{ status: string }>().status).toBe('green')

    const scan = await app.inject({ method: 'POST', url: '/missions/scan', payload: {} })
    expect(scan.statusCode).toBe(200)
    const scanned = scan.json<{ taskId: string; missionId: string }>()
    expect(scanned.taskId).toBeTruthy()

    const events = await app.inject({ method: 'GET', url: `/events?taskId=${scanned.taskId}` })
    expect(events.json<{ events: Array<{ kind: string }> }>().events[0]?.kind).toBe('roadmap.proposal.emitted')

    const missions = await app.inject({ method: 'GET', url: '/missions?status=approved&limit=1' })
    expect(missions.json<{ missions: Array<{ id: string }> }>().missions[0]?.id).toBe(scanned.missionId)

    const dispatch = await app.inject({ method: 'POST', url: `/missions/${scanned.missionId}/dispatch` })
    expect(dispatch.statusCode).toBe(200)

    const approval = await app.inject({
      method: 'POST',
      url: '/approvals',
      payload: { reason: 'smoke-check-3', operator: 'lanston' },
    })
    expect(approval.statusCode).toBe(200)
    const { approvalId } = approval.json<{ approvalId: string }>()
    const approved = await app.inject({ method: 'POST', url: `/approvals/${approvalId}/approve`, payload: { by: 'operator' } })
    expect(approved.statusCode).toBe(200)

    const sentinel = await app.inject({
      method: 'POST',
      url: '/sentinel/probe',
      payload: { tool: 'bash', args: 'cat .env.production' },
    })
    expect(sentinel.json<{ verdict: string }>().verdict).toBe('hard_block')

    const chaos = await app.inject({ method: 'POST', url: '/chaos/kill-session' })
    expect(chaos.statusCode).toBe(200)
    const resolved = await app.inject({ method: 'POST', url: '/chaos/resolve-latest-hold', payload: { by: 'operator' } })
    expect(resolved.statusCode).toBe(200)

    const metrics = await app.inject({ method: 'GET', url: '/metrics' })
    expect(metrics.body).toContain('events_total')

    const loki = await app.inject({ method: 'GET', url: '/loki/recent?limit=10' })
    expect(loki.statusCode).toBe(200)
  })

  it('runs the intake approval state machine through the API', async () => {
    const app = createServer(db, new Date(), stateDir)
    const intake = await app.inject({
      method: 'POST',
      url: '/intake',
      payload: { repoId: 'repo-1', description: 'Add sandbox page' },
    })
    expect(intake.statusCode).toBe(200)
    const { missionId } = intake.json<{ missionId: string }>()

    const directApprove = await app.inject({
      method: 'POST',
      url: `/missions/${missionId}/approve`,
      payload: { by: 'operator' },
    })
    expect(directApprove.statusCode).toBe(400)

    const pending = await app.inject({ method: 'POST', url: `/missions/${missionId}/request-approval` })
    expect(pending.statusCode).toBe(200)
    expect(pending.json<{ status: string }>().status).toBe('pending_approval')

    const beforeApprove = await app.inject({ method: 'GET', url: `/missions/${missionId}/can-execute` })
    expect(beforeApprove.json<{ canExecute: boolean }>().canExecute).toBe(false)

    const approved = await app.inject({
      method: 'POST',
      url: `/missions/${missionId}/approve`,
      payload: { by: 'operator' },
    })
    expect(approved.statusCode).toBe(200)
    expect(approved.json<{ status: string }>().status).toBe('approved')

    const afterApprove = await app.inject({ method: 'GET', url: `/missions/${missionId}/can-execute` })
    expect(afterApprove.json<{ canExecute: boolean }>().canExecute).toBe(true)
  })

  it('defaults intake artifacts under AEDEV_HOME/state when no explicit stateDir is passed', async () => {
    const aedevHome = mkdtempSync(join(tmpdir(), 'aedev-home-'))
    const previous = process.env['AEDEV_HOME']
    process.env['AEDEV_HOME'] = aedevHome

    try {
      const app = createServer(db)
      const intake = await app.inject({
        method: 'POST',
        url: '/intake',
        payload: { repoId: 'repo-1', description: 'Create default-state PRD' },
      })

      expect(intake.statusCode).toBe(200)
      const { missionId } = intake.json<{ missionId: string }>()
      expect(existsSync(join(aedevHome, 'state', 'prd', `${missionId}.md`))).toBe(true)
      expect(existsSync(join(aedevHome, 'prd', `${missionId}.md`))).toBe(false)
    } finally {
      restoreEnv('AEDEV_HOME', previous)
      rmSync(aedevHome, { recursive: true, force: true })
    }
  })

  it('scans repo-backed intake sources into draft missions through the API', async () => {
    const repoPath = mkdtempSync(join(tmpdir(), 'aedev-intake-scan-'))
    try {
      const repo = db.insertRepo({
        name: 'scan-target',
        path: repoPath,
        defaultBranch: 'main',
        enabled: true,
        testCommands: [],
        forbiddenPaths: [],
        riskRules: {},
        mergePolicy: 'WAITING',
      })
      writeFileSync(join(repoPath, 'src.ts'), '// TODO: scan this repo\n')

      const app = createServer(db, new Date(), stateDir)
      const res = await app.inject({
        method: 'POST',
        url: '/intake/scan',
        payload: { repoId: repo.id, capPerRepo: 5 },
      })

      expect(res.statusCode).toBe(200)
      const body = res.json<{ created: number; missions: Array<{ missionStatus?: string }> }>()
      expect(body.created).toBe(1)
      expect(body.missions[0]?.missionStatus).toBe('draft')
    } finally {
      rmSync(repoPath, { recursive: true, force: true })
    }
  })

  it('holds mission runs when runtime worker discovery finds no available sessions', async () => {
    const oldForceMock = process.env['AEDEV_COCKPIT_FORCE_MOCK']
    const oldDisableClaude = process.env['AEDEV_DISABLE_CLAUDE_CLI']
    const oldDisableCodex = process.env['AEDEV_DISABLE_CODEX_CLI']
    const oldDisableGemini = process.env['AEDEV_DISABLE_GEMINI_API']
    const oldDisableOpenai = process.env['AEDEV_DISABLE_OPENAI_API']
    delete process.env['AEDEV_COCKPIT_FORCE_MOCK']
    process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
    process.env['AEDEV_DISABLE_CODEX_CLI'] = '1'
    process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
    process.env['AEDEV_DISABLE_OPENAI_API'] = '1'

    try {
      const repo = db.insertRepo({
        name: 'run-target',
        path: stateDir,
        defaultBranch: 'main',
        enabled: true,
        testCommands: [],
        forbiddenPaths: [],
        riskRules: {},
        mergePolicy: 'WAITING',
      })
      const intake = new IntakeService(db, stateDir)
      const mission = intake.createMissionCandidate(repo.id, 'Exercise runtime worker discovery hold.', 'Runtime hold')
      intake.requestApproval(mission.id)
      intake.approveMission(mission.id, 'operator')

      const app = createServer(db, new Date(), stateDir)
      const res = await app.inject({ method: 'POST', url: `/missions/${mission.id}/run` })

      expect(res.statusCode).toBe(200)
      expect(res.json<{ status: string; mergeDecision: string }>().status).toBe('waiting')
      expect(db.getMission(mission.id)?.status).toBe('paused')
    } finally {
      restoreEnv('AEDEV_COCKPIT_FORCE_MOCK', oldForceMock)
      restoreEnv('AEDEV_DISABLE_CLAUDE_CLI', oldDisableClaude)
      restoreEnv('AEDEV_DISABLE_CODEX_CLI', oldDisableCodex)
      restoreEnv('AEDEV_DISABLE_GEMINI_API', oldDisableGemini)
      restoreEnv('AEDEV_DISABLE_OPENAI_API', oldDisableOpenai)
    }
  })

  it('runs the operator cockpit session flow through roadmap approval and evidence gate', async () => {
    const repo = db.insertRepo({
      name: 'cockpit-target',
      path: stateDir,
      defaultBranch: 'main',
      enabled: true,
      testCommands: [],
      forbiddenPaths: [],
      riskRules: {},
      mergePolicy: 'WAITING',
    })
    const oldAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
    const app = createServer(db, new Date(), stateDir)

    try {
      const created = await app.inject({
        method: 'POST',
        url: '/operator/sessions',
        payload: { repoId: repo.id, title: 'Cockpit demo', prompt: 'Build an operator cockpit demo' },
      })
      expect(created.statusCode).toBe(200)
      const createdBody = created.json<{ session: { id: string }; messages: Array<{ role: string; choices?: Array<{ action: string }> }> }>()
      const sessionId = createdBody.session.id
      const brainstormMsg = createdBody.messages.find((m) => m.role === 'assistant' && Array.isArray(m.choices) && m.choices.length > 0)
      expect(brainstormMsg?.choices?.map((c) => c.action)).toEqual(['generate-roadmap', 'ask-questions', 'add-constraints'])
      const latest = await app.inject({ method: 'GET', url: '/operator/sessions?latest=1' })
      expect(latest.statusCode).toBe(200)
      expect(latest.json<{ session: { id: string } }>().session.id).toBe(sessionId)

      const roadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
      expect(roadmap.statusCode).toBe(200)
      const missionId = roadmap.json<{ mission: { id: string }; artifacts: Array<{ type: string }> }>().mission.id
      expect(db.getMission(missionId)?.status).toBe('pending_approval')
      expect(roadmap.json<{ artifacts: Array<{ type: string }> }>().artifacts.map((a) => a.type)).toContain('prd')

      const approved = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/approve-roadmap` })
      expect(approved.statusCode).toBe(200)
      expect(approved.json<{ mission: { status: string } }>().mission.status).toBe('approved')

      const started = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/start` })
      expect(started.statusCode).toBe(200)
      const startedBody = started.json<{ result: { status: string; mergeDecision: string }; overview: { artifacts: unknown[]; runs: unknown[] } }>()
      expect(startedBody.result.status).toBe('waiting')
      expect(startedBody.result.mergeDecision).toBe('WAITING')
      expect(startedBody.overview.artifacts.length).toBeGreaterThan(0)
      expect(startedBody.overview.runs.length).toBe(1)

      const overview = await app.inject({ method: 'GET', url: `/missions/${missionId}/overview` })
      expect(overview.statusCode).toBe(200)
      const body = overview.json<{
        stage: string
        progress: number
        validatorStatus: string
        cost: { costUsd: number | null; inputTokens: number | null }
        approvals: unknown[]
        artifacts: Array<{ preview?: string | null }>
        events: Array<{ type: string }>
        operatorView: {
          stage: string
          confidence: number
          projectPulse: { progress: unknown[]; validatorReviews: Array<{ verdict: string; evidenceGaps: string[] }> }
          memorySummary: { projectFacts: Array<{ provenance: string; ttlDays: number; superseded: boolean }>; userPreferences: unknown[] }
        }
      }>()
      expect(body.stage).toBe('PR/Waiting/Blocked')
      expect(body.progress).toBeGreaterThan(0)
      expect(body.validatorStatus).toBe('not_configured')
      expect(body.operatorView.stage).toBe('validators_missing')
      expect(body.operatorView.confidence).toBeGreaterThan(0)
      expect(body.operatorView.projectPulse.progress.length).toBeGreaterThanOrEqual(5)
      expect(body.operatorView.projectPulse.validatorReviews[0]?.verdict).toBe('not_configured')
      expect(body.operatorView.projectPulse.validatorReviews[0]?.evidenceGaps.length).toBeGreaterThan(0)
      expect(body.operatorView.memorySummary.projectFacts[0]).toMatchObject({ provenance: expect.any(String), ttlDays: expect.any(Number), superseded: false })
      expect(body.operatorView.memorySummary.userPreferences.length).toBeGreaterThan(0)
      expect(body.cost.costUsd).toBeNull()
      expect(body.cost.inputTokens).toBeNull()
      expect(body.approvals.length).toBe(1)
      expect(body.artifacts.some((a) => a.preview)).toBe(true)
      const eventTypes = body.events.map((e) => e.type)
      for (const milestone of ['operator.roadmap_generation_done', 'operator.approval_recorded', 'operator.worker_assigned', 'operator.evidence_written']) {
        expect(eventTypes).toContain(milestone)
      }

      const latestRun = startedBody.overview.runs[0] as { id: string }
      const log = await app.inject({ method: 'GET', url: `/missions/${missionId}/runs/${latestRun.id}/log` })
      expect(log.statusCode).toBe(200)
      expect(log.json<{ text: string }>().text).toContain('mock worker')

      const blockedPr = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/create-pr` })
      expect(blockedPr.statusCode).toBe(200)
      expect(blockedPr.json<{ status: string; code: string }>().status).toBe('blocked')
      expect(blockedPr.json<{ code: string }>().code).toBe('GEMINI_NOT_CONFIGURED')

      const paused = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/pause` })
      expect(paused.statusCode).toBe(200)
      expect(paused.json<{ overview: { mission: { status: string } } }>().overview.mission.status).toBe('paused')

      const resumed = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/resume` })
      expect(resumed.statusCode).toBe(200)
      expect(resumed.json<{ overview: { mission: { status: string } } }>().overview.mission.status).toBe('approved')
    } finally {
      restoreEnv('AEDEV_ALLOW_REMOTE_WRITES', oldAllow)
    }
  })

  it('Project Pulse reads touched files from the real changed-paths evidence artifact', async () => {
    const repo = db.insertRepo({
      name: 'pulse-repo',
      path: stateDir,
      defaultBranch: 'main',
      enabled: true,
      testCommands: [],
      forbiddenPaths: ['.env*'],
      riskRules: {},
      mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({ repoId: repo.id, title: 'Pulse', description: 'd', status: 'done' })
    const evidenceDir = join(stateDir, 'pulse-evidence')
    mkdirSync(evidenceDir, { recursive: true })
    const changedPath = join(evidenceDir, 'changed-paths.json')
    writeFileSync(changedPath, JSON.stringify({ changedPaths: ['README.md', 'src/app.ts'] }, null, 2))
    db.upsertMissionArtifact({ missionId: mission.id, type: 'report', path: changedPath, title: 'Changed paths' })
    const app = createServer(db, new Date(), stateDir)

    const overview = await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })
    expect(overview.statusCode).toBe(200)
    const body = overview.json<{ operatorView: { projectPulse: { touchedFiles: string[] } } }>()
    expect(body.operatorView.projectPulse.touchedFiles).toEqual(['README.md', 'src/app.ts'])
  })

  it('OperatorMissionView remoteWrites uses the route stateDir config, matching the PR gate', async () => {
    const oldAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
    delete process.env['AEDEV_ALLOW_REMOTE_WRITES']
    try {
      writeFileSync(join(stateDir, 'config.yaml'), 'allow_remote_writes: true\n')
      const repo = db.insertRepo({
        name: 'gate-repo',
        path: stateDir,
        defaultBranch: 'main',
        enabled: true,
        testCommands: [],
        forbiddenPaths: [],
        riskRules: {},
        mergePolicy: 'WAITING',
      })
      const mission = db.insertMission({ repoId: repo.id, title: 'Gate', description: 'd', status: 'done' })
      const app = createServer(db, new Date(), stateDir)

      const overview = await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })
      expect(overview.statusCode).toBe(200)
      const body = overview.json<{ operatorView: { safetySummary: { remoteWrites: string } } }>()
      expect(body.operatorView.safetySummary.remoteWrites).toBe('enabled')
    } finally {
      restoreEnv('AEDEV_ALLOW_REMOTE_WRITES', oldAllow)
    }
  })

  it('mission overview shows Gemini as configured when the validator key is present', async () => {
    const oldGemini = process.env['AEDEV_GEMINI_API_KEY']
    const oldGeminiAlias = process.env['GEMINI_API_KEY']
    const oldGoogleAlias = process.env['GOOGLE_API_KEY']
    const oldOpenai = process.env['AEDEV_OPENAI_API_KEY']
    const oldOpenaiAlias = process.env['OPENAI_API_KEY']
    process.env['AEDEV_GEMINI_API_KEY'] = 'test-gemini-key'
    delete process.env['GEMINI_API_KEY']
    delete process.env['GOOGLE_API_KEY']
    delete process.env['AEDEV_OPENAI_API_KEY']
    delete process.env['OPENAI_API_KEY']
    try {
      const repo = db.insertRepo({
        name: 'gemini-repo',
        path: stateDir,
        defaultBranch: 'main',
        enabled: true,
        testCommands: [],
        forbiddenPaths: [],
        riskRules: {},
        mergePolicy: 'WAITING',
      })
      const mission = db.insertMission({ repoId: repo.id, title: 'Gemini', description: 'd', status: 'done' })
      const app = createServer(db, new Date(), stateDir)

      const overview = await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })
      expect(overview.statusCode).toBe(200)
      const body = overview.json<{
        validatorStatus: string
        operatorView: { providerSummary: { validators: Array<{ name: string; mode: string; status?: string }> } }
      }>()
      expect(body.validatorStatus).toBe('pending')
      expect(body.operatorView.providerSummary.validators).toEqual([
        { name: 'gemini', mode: 'validator-api-only', status: 'pending' },
      ])
    } finally {
      restoreEnv('AEDEV_GEMINI_API_KEY', oldGemini)
      restoreEnv('GEMINI_API_KEY', oldGeminiAlias)
      restoreEnv('GOOGLE_API_KEY', oldGoogleAlias)
      restoreEnv('AEDEV_OPENAI_API_KEY', oldOpenai)
      restoreEnv('OPENAI_API_KEY', oldOpenaiAlias)
    }
  })

  it('ask-questions runs a real planner follow-up that adds an assistant reply with questions, not just a user message', async () => {
    const app = createServer(db, new Date(), stateDir)
    const created = await app.inject({ method: 'POST', url: '/operator/sessions', payload: { title: 'Followup', prompt: 'Improve the README wording' } })
    const sessionId = created.json<{ session: { id: string } }>().session.id

    const ask = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/ask`, payload: { prompt: '请先不要执行，先问我 3 个必须确认的问题' } })
    expect(ask.statusCode).toBe(200)
    const body = ask.json<{ session: { status: string }; messages: Array<{ role: string; content: string; choices?: Array<{ action: string }> }> }>()

    // the operator's request is recorded as a user message
    expect(body.messages.some((m) => m.role === 'user' && m.content.includes('问'))).toBe(true)
    // and the planner actually replied with a follow-up assistant message containing questions + fresh choices
    const followup = body.messages.find((m) => m.role === 'assistant' && /Operator Questions/.test(m.content) && Array.isArray(m.choices) && m.choices.length === 2)
    expect(followup).toBeTruthy()
    expect(followup?.choices?.map((c) => c.action)).toEqual(['ask-questions', 'add-constraints'])
    expect(body.session.status).toBe('clarifying')
  })

  it('creates a visible roadmap HOLD when planner JSON is invalid', async () => {
    const oldFixture = process.env['AEDEV_COCKPIT_PLANNER_FIXTURE_JSON']
    const oldTemplate = process.env['AEDEV_COCKPIT_FORCE_TEMPLATE']
    process.env['AEDEV_COCKPIT_PLANNER_FIXTURE_JSON'] = '{not json'
    process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '0'
    try {
      const app = createServer(db, new Date(), stateDir)
      const created = await app.inject({
        method: 'POST',
        url: '/operator/sessions',
        payload: { title: 'Bad planner', prompt: 'Produce invalid planner JSON hold' },
      })
      const sessionId = created.json<{ session: { id: string } }>().session.id
      const roadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
      expect(roadmap.statusCode).toBe(200)
      const body = roadmap.json<{ hold: { code: string }; messages: Array<{ content: string }> }>()
      expect(body.hold.code).toBe('HOLD-ROADMAP-PLANNER')
      expect(body.messages.at(-1)?.content).toContain('HOLD-ROADMAP-PLANNER')
    } finally {
      restoreEnv('AEDEV_COCKPIT_PLANNER_FIXTURE_JSON', oldFixture)
      restoreEnv('AEDEV_COCKPIT_FORCE_TEMPLATE', oldTemplate)
    }
  })

  it('rejects Codex as a planner provider in P1', async () => {
    const oldProvider = process.env['AEDEV_COCKPIT_PLANNER_PROVIDER']
    const oldTemplate = process.env['AEDEV_COCKPIT_FORCE_TEMPLATE']
    try {
      const app = createServer(db, new Date(), stateDir)
      const created = await app.inject({
        method: 'POST',
        url: '/operator/sessions',
        payload: { title: 'Planner split', prompt: 'Generate the plan with the configured planner' },
      })
      const sessionId = created.json<{ session: { id: string } }>().session.id
      process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] = 'codex'
      process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '0'

      const roadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
      expect(roadmap.statusCode).toBe(200)
      const body = roadmap.json<{ hold: { code: string }; messages: Array<{ content: string }> }>()
      expect(body.hold.code).toBe('HOLD-ROADMAP-PLANNER')
      expect(body.messages.at(-1)?.content).toContain("P1 requires claude-cli")
    } finally {
      restoreEnv('AEDEV_COCKPIT_PLANNER_PROVIDER', oldProvider)
      restoreEnv('AEDEV_COCKPIT_FORCE_TEMPLATE', oldTemplate)
    }
  })

  it('P2 blocks roadmap/start until clarification confidence is >=95 and no questions are pending', async () => {
    const oldBrainstorm = process.env['AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT']
    const oldFollowup = process.env['AEDEV_COCKPIT_PLANNER_FOLLOWUP_FIXTURE_TEXT']
    try {
      process.env['AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT'] = plannerTextFixture({
        confidence: 62,
        rationale: 'The request is still too broad.',
        questions: [
          { field: 'scope', question: 'Which slice should be changed first?', options: [{ label: 'Small docs slice', recommended: true }, { label: 'Whole app' }] },
        ],
      })
      const app = createServer(db, new Date(), stateDir)
      const created = await app.inject({
        method: 'POST',
        url: '/operator/sessions',
        payload: { title: 'Ambiguous P2', prompt: 'improve everything in the whole app' },
      })
      const sessionId = created.json<{ session: { id: string; status: string }; messages: Array<{ questions?: Array<{ id: string; options: Array<{ label: string }> }> }> }>().session.id
      expect(created.json<{ session: { status: string } }>().session.status).toBe('clarifying')
      const firstQuestions = created.json<{ messages: Array<{ questions?: Array<{ id: string; options: Array<{ label: string }> }> }> }>()
        .messages.find((m) => m.questions?.length)?.questions ?? []

      const earlyRoadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
      expect(earlyRoadmap.statusCode).toBe(409)
      expect(earlyRoadmap.json<{ blocked: { code: string; confidence: number; pendingQuestionIds: string[] } }>().blocked).toMatchObject({
        code: 'CLARIFY_GATE_BLOCKED',
        confidence: 62,
      })
      expect(earlyRoadmap.json<{ blocked: { pendingQuestionIds: string[] } }>().blocked.pendingQuestionIds).toHaveLength(1)

      const earlyStart = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/start` })
      expect(earlyStart.statusCode).toBe(409)
      expect(earlyStart.json<{ blocked: { code: string } }>().blocked.code).toBe('CLARIFY_GATE_BLOCKED')

      const answer = await app.inject({
        method: 'POST',
        url: `/operator/sessions/${sessionId}/answer-questions`,
        payload: { answers: [{ questionId: firstQuestions[0]!.id, value: firstQuestions[0]!.options[0]!.label }] },
      })
      expect(answer.statusCode).toBe(200)
      expect(answer.json<{ session: { status: string } }>().session.status).toBe('clarifying')

      const answeredButLow = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
      expect(answeredButLow.statusCode).toBe(409)
      expect(answeredButLow.json<{ blocked: { confidence: number; pendingQuestionIds: string[] } }>().blocked).toMatchObject({
        confidence: 62,
        pendingQuestionIds: [],
      })

      process.env['AEDEV_COCKPIT_PLANNER_FOLLOWUP_FIXTURE_TEXT'] = plannerTextFixture({
        confidence: 96,
        rationale: 'The operator answer narrows this enough for a roadmap.',
        questions: [],
      })
      const followup = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/ask`, payload: { prompt: 'Re-check confidence after my answer.' } })
      expect(followup.statusCode).toBe(200)
      expect(followup.json<{ session: { status: string } }>().session.status).toBe('brainstorm_ready')

      const roadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
      expect(roadmap.statusCode).toBe(200)
      expect(roadmap.json<{ mission: { status: string } }>().mission.status).toBe('pending_approval')
      expect(db.queryEvents({ type: 'clarify.round', entityId: sessionId })).toHaveLength(2)
      expect(db.queryEvents({ type: 'clarify.unlocked', entityId: sessionId })).toHaveLength(1)
    } finally {
      restoreEnv('AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT', oldBrainstorm)
      restoreEnv('AEDEV_COCKPIT_PLANNER_FOLLOWUP_FIXTURE_TEXT', oldFollowup)
    }
  })

  it('P2 lets a clear high-confidence planner fixture generate a roadmap immediately', async () => {
    const oldBrainstorm = process.env['AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT']
    try {
      process.env['AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT'] = plannerTextFixture({
        confidence: 97,
        rationale: 'The target and acceptance are explicit.',
        questions: [],
      })
      const app = createServer(db, new Date(), stateDir)
      const created = await app.inject({
        method: 'POST',
        url: '/operator/sessions',
        payload: { title: 'Clear P2', prompt: 'Add README test docs with exact acceptance.' },
      })
      const sessionId = created.json<{ session: { id: string; status: string } }>().session.id
      expect(created.json<{ session: { status: string } }>().session.status).toBe('brainstorm_ready')

      const roadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
      expect(roadmap.statusCode).toBe(200)
      expect(roadmap.json<{ mission: { status: string } }>().mission.status).toBe('pending_approval')
    } finally {
      restoreEnv('AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT', oldBrainstorm)
    }
  })

  it('turns a present but broken local CLI into a visible cockpit HOLD instead of a failed run', async () => {
    const stub = join(stateDir, 'broken-codex')
    writeFileSync(stub, '#!/bin/sh\necho "auth expired" >&2\nexit 2\n')
    chmodSync(stub, 0o755)
    const oldForceMock = process.env['AEDEV_COCKPIT_FORCE_MOCK']
    const oldForceReal = process.env['AEDEV_COCKPIT_FORCE_REAL']
    const oldCodex = process.env['AEDEV_CODEX_BIN']
    const oldDisableClaude = process.env['AEDEV_DISABLE_CLAUDE_CLI']
    const oldDisableGemini = process.env['AEDEV_DISABLE_GEMINI_API']
    const oldDisableOpenai = process.env['AEDEV_DISABLE_OPENAI_API']
    delete process.env['AEDEV_COCKPIT_FORCE_MOCK']
    process.env['AEDEV_COCKPIT_FORCE_REAL'] = '1'
    process.env['AEDEV_CODEX_BIN'] = stub
    process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
    process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
    process.env['AEDEV_DISABLE_OPENAI_API'] = '1'
    try {
      // FORCE_REAL missions hit validateTargetRepo, which requires a git repo
      // with commits — give the session a real tmp fixture (the auto-created
      // fallback repo is a bare tmp dir under the test runtime).
      const workspace = mkdtempSync(join(tmpdir(), 'aedev-broken-cli-repo-'))
      const git = (args: string[]) => execFileSync('git', args, { cwd: workspace, stdio: 'ignore' })
      git(['init', '-q', '-b', 'main'])
      git(['-c', 'user.email=test@aedev.invalid', '-c', 'user.name=aedev-test', '-c', 'commit.gpgsign=false', 'commit', '--allow-empty', '-q', '-m', 'init'])
      db.insertRepo({
        name: 'broken-cli-repo', path: workspace, defaultBranch: 'main', enabled: true,
        testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'low-risk',
      })
      const app = createServer(db, new Date(), stateDir)
      const created = await app.inject({ method: 'POST', url: '/operator/sessions', payload: { title: 'Broken CLI', prompt: 'Run with broken CLI' } })
      const sessionId = created.json<{ session: { id: string } }>().session.id
      const roadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
      const missionId = roadmap.json<{ mission: { id: string } }>().mission.id
      await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/approve-roadmap` })
      const started = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/start` })
      expect(started.statusCode).toBe(200)
      const body = started.json<{ result: { status: string }; overview: { holds: Array<{ payload: { holdCode?: string } }>; runs: unknown[] } }>()
      expect(body.result.status).toBe('waiting')
      expect(body.overview.holds.some((h) => h.payload.holdCode === 'HOLD-SESSION-POOL')).toBe(true)
      expect(body.overview.runs).toHaveLength(0)
      expect(db.getMission(missionId)?.status).toBe('paused')
    } finally {
      restoreEnv('AEDEV_COCKPIT_FORCE_MOCK', oldForceMock)
      restoreEnv('AEDEV_COCKPIT_FORCE_REAL', oldForceReal)
      restoreEnv('AEDEV_CODEX_BIN', oldCodex)
      restoreEnv('AEDEV_DISABLE_CLAUDE_CLI', oldDisableClaude)
      restoreEnv('AEDEV_DISABLE_GEMINI_API', oldDisableGemini)
      restoreEnv('AEDEV_DISABLE_OPENAI_API', oldDisableOpenai)
    }
  })

  it('keeps create-pr blocked when remote writes are disabled without calling the injected executor', async () => {
    const oldAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
    let executorCalls = 0
    try {
      const app = createServer(db, new Date(), stateDir, {
        draftPrExecutor: {
          async openDraftPr() {
            executorCalls += 1
            return { number: 1, url: 'https://github.com/owner/repo/pull/1', state: 'open', draft: true }
          },
        },
      })
      const { sessionId } = await prepareCockpitMission(app)
      const pr = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/create-pr` })
      expect(pr.statusCode).toBe(200)
      expect(pr.json<{ status: string; code: string }>().status).toBe('blocked')
      expect(pr.json<{ code: string }>().code).toBe('REMOTE_WRITES_DISABLED')
      expect(JSON.stringify(pr.json())).not.toContain('example.invalid')
      expect(executorCalls).toBe(0)
    } finally {
      restoreEnv('AEDEV_ALLOW_REMOTE_WRITES', oldAllow)
    }
  })

  it('P4 blocks create-pr when Gemini does not PASS and writes the verdict into the conversation', async () => {
    const oldAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '1'
    let executorCalls = 0
    try {
      const app = createServer(db, new Date(), stateDir, {
        draftPrExecutor: {
          async openDraftPr() {
            executorCalls += 1
            return { number: 44, url: 'https://github.com/owner/repo/pull/44', state: 'open', draft: true }
          },
        },
      })
      const { sessionId, missionId } = await prepareCockpitMission(app, { geminiVerdict: 'fail', geminiSummary: 'Missing regression test for the changed behavior.' })
      const pr = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/create-pr` })
      expect(pr.statusCode).toBe(200)
      const body = pr.json<{ status: string; code: string; reason: string; overview: { operatorView?: { safetySummary?: { prGate?: { code?: string } } } } }>()
      expect(body.status).toBe('blocked')
      expect(body.code).toBe('GEMINI_NOT_PASS')
      expect(body.reason).toContain('Missing regression test')
      expect(body.overview.operatorView?.safetySummary?.prGate?.code).toBe('GEMINI_NOT_PASS')
      expect(executorCalls).toBe(0)
      expect(db.getMission(missionId)?.githubPrUrl).toBeNull()
      expect(db.listOperatorMessages(sessionId).at(-1)?.content).toContain('Gemini hard gate blocked Draft PR')
      expect(db.queryEvents({ type: 'operator.gemini_pr_blocked', entityId: missionId })).toHaveLength(1)
    } finally {
      restoreEnv('AEDEV_ALLOW_REMOTE_WRITES', oldAllow)
    }
  })

  it('turns an enabled but unavailable draft PR executor into a visible HOLD, not fake success', async () => {
    const oldAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
    const oldWhitelist = process.env['AEDEV_REMOTE_WRITE_WHITELIST']
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '1'
    process.env['AEDEV_REMOTE_WRITE_WHITELIST'] = 'local-workspace'
    try {
      const app = createServer(db, new Date(), stateDir)
      const { sessionId, missionId } = await prepareCockpitMission(app)
      const pr = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/create-pr` })
      expect(pr.statusCode).toBe(200)
      const body = pr.json<{ status: string; code: string; reason: string; overview: { holds: Array<{ payload: { holdCode?: string } }> } }>()
      expect(body.status).toBe('blocked')
      expect(body.code).toBe('DRAFT_PR_EXECUTOR_UNAVAILABLE')
      expect(body.reason).toContain('remote-write executor is not configured')
      expect(body.overview.holds.some((h) => h.payload.holdCode === 'HOLD-DRAFT-PR-EXECUTOR')).toBe(true)
      expect(JSON.stringify(body)).not.toContain('example.invalid')
      expect(db.getMission(missionId)?.githubPrUrl).toBeNull()
    } finally {
      restoreEnv('AEDEV_ALLOW_REMOTE_WRITES', oldAllow)
      restoreEnv('AEDEV_REMOTE_WRITE_WHITELIST', oldWhitelist)
    }
  })

  it('uses an injected side-effect executor for idempotent draft PR reuse without example.invalid', async () => {
    const oldAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
    const oldWhitelist = process.env['AEDEV_REMOTE_WRITE_WHITELIST']
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '1'
    process.env['AEDEV_REMOTE_WRITE_WHITELIST'] = 'local-workspace'
    const calls: string[] = []
    try {
      const app = createServer(db, new Date(), stateDir, {
        draftPrExecutor: {
          async openDraftPr(req) {
            calls.push(req.missionId)
            return { number: 12, url: 'https://github.com/owner/repo/pull/12', state: 'open', draft: true }
          },
        },
      })
      const { sessionId, missionId } = await prepareCockpitMission(app)
      const first = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/create-pr` })
      const second = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/create-pr` })
      expect(first.json<{ status: string; pr: { url: string; number: number; draft: boolean } }>().status).toBe('created')
      expect(second.json<{ status: string; pr: { url: string; number: number; draft: boolean } }>().pr).toEqual({
        number: 12,
        url: 'https://github.com/owner/repo/pull/12',
        state: 'open',
        draft: true,
      })
      expect(calls).toEqual([missionId, missionId])
      expect(JSON.stringify(first.json())).not.toContain('example.invalid')
      expect(db.getMission(missionId)?.githubPrUrl).toBe('https://github.com/owner/repo/pull/12')
    } finally {
      restoreEnv('AEDEV_ALLOW_REMOTE_WRITES', oldAllow)
      restoreEnv('AEDEV_REMOTE_WRITE_WHITELIST', oldWhitelist)
    }
  })
})

function isListenPermissionError(error: unknown): boolean {
  return /listen EPERM|operation not permitted/i.test((error as Error).message)
}

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key]
  else process.env[key] = value
}

function plannerTextFixture(payload: {
  confidence: number
  rationale: string
  questions: Array<{ field: string; question: string; options: Array<{ label: string; recommended?: true }> }>
}): string {
  return [
    'Planner fixture.',
    '',
    '```json',
    JSON.stringify(payload),
    '```',
  ].join('\n')
}

async function prepareCockpitMission(
  app: ReturnType<typeof createServer>,
  opts: { geminiVerdict?: 'pass' | 'fail' | 'inconclusive' | null; geminiSummary?: string } = {},
): Promise<{ sessionId: string; missionId: string }> {
  const created = await app.inject({ method: 'POST', url: '/operator/sessions', payload: { title: 'Draft PR', prompt: 'Reach draft PR gate' } })
  const sessionId = created.json<{ session: { id: string } }>().session.id
  const roadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
  const missionId = roadmap.json<{ mission: { id: string } }>().mission.id
  await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/approve-roadmap` })
  const started = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/start` })
  expect(started.statusCode).toBe(200)
  expect(started.json<{ result: { status: string } }>().result.status).toBe('waiting')
  if (opts.geminiVerdict !== null) {
    const task = db.listTasks(missionId)[0]
    if (!task) throw new Error('prepareCockpitMission expected a worker task')
    const run = db.listRuns(task.id)[0]
    if (!run) throw new Error('prepareCockpitMission expected a worker run')
    db.insertValidatorResult({
      taskId: task.id,
      runId: run.id,
      validator: 'gemini',
      verdict: opts.geminiVerdict ?? 'pass',
      summary: opts.geminiSummary ?? 'Gemini PASS fixture for Draft PR gate tests.',
      evidenceBundlePath: run.evidenceDir ? join(run.evidenceDir, 'validator-gemini.md') : undefined,
    })
  }
  return { sessionId, missionId }
}
