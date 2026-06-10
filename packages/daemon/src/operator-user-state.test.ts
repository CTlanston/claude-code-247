import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'

// v-ux-1 — non-developer UX: the operator view carries a human userState,
// progress visibility (lastActivity) and a loop summary; CLARIFY-gate 409s
// carry a humanState + bilingual guidance instead of only raw codes.

let db: AedevDb
let stateDir: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-user-state-'))
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
})

function makeRepo() {
  return db.insertRepo({
    name: 'ux-state', path: stateDir, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
}

interface OverviewShape {
  operatorView: {
    userState: { state: string; label: string; labelZh: string; explanation: string }
    lastActivity: { atIso: string | null; agoMs: number | null; phase: string }
    loopSummary: { whatChanged: string[]; testsRan: string[]; agents: string[]; validatorSaid: string | null; whyStoppedOrContinuing: string }
  }
}

describe('operator view — userState / lastActivity / loopSummary', () => {
  it('exposes a waiting_for_approval userState for a pending-approval mission', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'pending_approval' })
    db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'p', status: 'roadmap_ready' })
    db.insertEvent('operator.stage_changed', 'mission', mission.id, { stage: 'Roadmap' })

    const ov = (await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })).json() as OverviewShape
    expect(ov.operatorView.userState.state).toBe('waiting_for_approval')
    expect(ov.operatorView.userState.labelZh.length).toBeGreaterThan(0)
    expect(ov.operatorView.userState.explanation).not.toMatch(/HTTP|409|CLARIFY_GATE_BLOCKED/)
  })

  it('flips userState to blocked with a human explanation while a HOLD is active', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'approved' })
    db.insertHold({ entityType: 'mission', entityId: mission.id, code: 'HOLD-BUDGET', reason: 'daily cap reached' })

    const ov = (await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })).json() as OverviewShape
    expect(ov.operatorView.userState.state).toBe('blocked')
    expect(ov.operatorView.userState.explanation).toContain('今日预算已用完')
    expect(ov.operatorView.userState.explanation).not.toContain('HOLD-BUDGET')
  })

  it('derives lastActivity from the newest event and marks the planning phase in flight', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'draft' })
    const session = db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'p', status: 'brainstorming' })
    db.insertEvent('operator.role_started', 'operator_session', session.id, { role: 'planner' })

    const ov = (await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })).json() as OverviewShape
    expect(ov.operatorView.lastActivity.atIso).toBeTruthy()
    expect(ov.operatorView.lastActivity.agoMs).not.toBeNull()
    expect(ov.operatorView.lastActivity.agoMs!).toBeGreaterThanOrEqual(0)
    expect(ov.operatorView.lastActivity.phase).toBe('planning')
  })

  it('marks the executing phase while a run is in flight', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'running' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 't', prompt: 'p', status: 'running', attemptNumber: 0 })
    db.insertRun({ taskId: task.id, runnerMode: 'codex-cli', status: 'running', startedAt: new Date().toISOString(), evidenceDir: stateDir })
    db.insertEvent('operator.worker_started', 'mission', mission.id, { provider: 'codex' })

    const ov = (await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })).json() as OverviewShape
    expect(ov.operatorView.lastActivity.phase).toBe('executing')
  })

  it('summarises the loop from existing overview inputs (no new endpoints)', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'done' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 't', prompt: 'p', status: 'done', attemptNumber: 0 })
    const run = db.insertRun({ taskId: task.id, runnerMode: 'codex-cli', status: 'done', startedAt: new Date().toISOString(), evidenceDir: stateDir })
    db.insertValidatorResult({ taskId: task.id, runId: run.id, validator: 'gemini', verdict: 'pass', summary: 'evidence proves the change' })
    db.insertEvent('operator.evidence_written', 'mission', mission.id, { changedPaths: ['src/a.ts', 'src/b.ts'] })

    const ov = (await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })).json() as OverviewShape
    const loop = ov.operatorView.loopSummary
    expect(loop.whatChanged).toContain('src/a.ts')
    expect(loop.agents.some((a) => /worker/.test(a))).toBe(true)
    expect(loop.validatorSaid).toContain('pass')
    expect(loop.whyStoppedOrContinuing.length).toBeGreaterThan(0)
    expect(Array.isArray(loop.testsRan)).toBe(true)
  })
})

describe('CLARIFY-gate 409s — humanState + bilingual guidance', () => {
  async function blockedSession(app: ReturnType<typeof createServer>) {
    const repo = makeRepo()
    const created = await app.inject({
      method: 'POST',
      url: '/operator/sessions',
      payload: { repoId: repo.id, title: 'Ambiguous', prompt: 'improve everything in the whole project' },
    })
    expect(created.statusCode).toBe(200)
    return (created.json() as { session: { id: string } }).session.id
  }

  it('generate-roadmap 409 carries humanState=needs_more_context and friendly guidance', async () => {
    const app = createServer(db, new Date(), stateDir)
    const sessionId = await blockedSession(app)
    const res = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/generate-roadmap` })
    expect(res.statusCode).toBe(409)
    const body = res.json() as { humanState: string; guidance: string; blocked: { code: string } }
    expect(body.blocked.code).toBe('CLARIFY_GATE_BLOCKED')
    expect(body.humanState).toBe('needs_more_context')
    expect(body.guidance).toMatch(/确认|回答/)
    expect(body.guidance).toMatch(/answer/i)
    expect(body.guidance).not.toMatch(/CLARIFY_GATE_BLOCKED|409/)
  })

  it('start 409 carries the same humanState + guidance contract', async () => {
    const app = createServer(db, new Date(), stateDir)
    const sessionId = await blockedSession(app)
    const res = await app.inject({ method: 'POST', url: `/operator/sessions/${sessionId}/start` })
    expect(res.statusCode).toBe(409)
    const body = res.json() as { humanState: string; guidance: string }
    expect(body.humanState).toBe('needs_more_context')
    expect(body.guidance).not.toMatch(/CLARIFY_GATE_BLOCKED|409/)
  })
})
