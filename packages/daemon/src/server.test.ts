import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import type { AddressInfo } from 'net'
import { chmodSync, existsSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
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
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
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
    const oldDisableClaude = process.env['AEDEV_DISABLE_CLAUDE_CLI']
    const oldDisableCodex = process.env['AEDEV_DISABLE_CODEX_CLI']
    const oldDisableGemini = process.env['AEDEV_DISABLE_GEMINI_API']
    const oldDisableOpenai = process.env['AEDEV_DISABLE_OPENAI_API']
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
      const body = overview.json<{ stage: string; progress: number; validatorStatus: string; cost: { costUsd: number | null; inputTokens: number | null }; approvals: unknown[]; artifacts: Array<{ preview?: string | null }>; events: Array<{ type: string }> }>()
      expect(body.stage).toBe('PR/Waiting/Blocked')
      expect(body.progress).toBeGreaterThan(0)
      expect(body.validatorStatus).toBe('not_configured')
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
      expect(blockedPr.json<{ code: string }>().code).toBe('REMOTE_WRITES_DISABLED')

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
    const followup = body.messages.find((m) => m.role === 'assistant' && /Operator Questions/.test(m.content) && Array.isArray(m.choices) && m.choices.length === 3)
    expect(followup).toBeTruthy()
    expect(followup?.choices?.map((c) => c.action)).toEqual(['generate-roadmap', 'ask-questions', 'add-constraints'])
    expect(body.session.status).toBe('brainstorm_ready')
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

  it('turns a present but broken local CLI into a visible cockpit HOLD instead of a failed run', async () => {
    const stub = join(stateDir, 'broken-codex')
    writeFileSync(stub, '#!/bin/sh\necho "auth expired" >&2\nexit 2\n')
    chmodSync(stub, 0o755)
    const oldForceReal = process.env['AEDEV_COCKPIT_FORCE_REAL']
    const oldCodex = process.env['AEDEV_CODEX_BIN']
    const oldDisableClaude = process.env['AEDEV_DISABLE_CLAUDE_CLI']
    const oldDisableGemini = process.env['AEDEV_DISABLE_GEMINI_API']
    const oldDisableOpenai = process.env['AEDEV_DISABLE_OPENAI_API']
    process.env['AEDEV_COCKPIT_FORCE_REAL'] = '1'
    process.env['AEDEV_CODEX_BIN'] = stub
    process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
    process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
    process.env['AEDEV_DISABLE_OPENAI_API'] = '1'
    try {
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

  it('turns an enabled but unavailable draft PR executor into a visible HOLD, not fake success', async () => {
    const oldAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '1'
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
    }
  })

  it('uses an injected side-effect executor for idempotent draft PR reuse without example.invalid', async () => {
    const oldAllow = process.env['AEDEV_ALLOW_REMOTE_WRITES']
    process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '1'
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

async function prepareCockpitMission(app: ReturnType<typeof createServer>): Promise<{ sessionId: string; missionId: string }> {
  const created = await app.inject({ method: 'POST', url: '/operator/sessions', payload: { title: 'Draft PR', prompt: 'Reach draft PR gate' } })
  const sessionId = created.json<{ session: { id: string } }>().session.id
  const roadmap = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
  const missionId = roadmap.json<{ mission: { id: string } }>().mission.id
  await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/approve-roadmap` })
  const started = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/start` })
  expect(started.statusCode).toBe(200)
  expect(started.json<{ result: { status: string } }>().result.status).toBe('waiting')
  return { sessionId, missionId }
}
