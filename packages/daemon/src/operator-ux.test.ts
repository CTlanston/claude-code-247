import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb, nowIso } from '@aedev/core'
import { createServer } from './server.js'

// Phase 1 (Operator Cockpit UX v2): structured questions, HOLD lifecycle, run progress.
// Deterministic: VITEST makes the planner brainstorm/followup synthetic, so no real CLI is hit.

let db: AedevDb
let stateDir: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-operator-ux-'))
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
})

function makeRepo() {
  return db.insertRepo({
    name: 'ux-test', path: stateDir, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
}

async function startSession(app: ReturnType<typeof createServer>, prompt: string) {
  const repo = makeRepo()
  const res = await app.inject({ method: 'POST', url: '/operator/sessions', payload: { repoId: repo.id, title: 'UX', prompt } })
  expect(res.statusCode).toBe(200)
  return { repo, body: res.json() as { session: { id: string }; messages: Array<{ role: string; content: string; questions?: unknown[]; meta?: Record<string, unknown> }> } }
}

describe('operator cockpit UX v2 — backend foundations', () => {
  it('attaches structured questions + provider meta to the brainstorm turn', async () => {
    const app = createServer(db, new Date(), stateDir)
    const { body } = await startSession(app, 'improve everything in the whole project')
    const assistant = body.messages.filter((m) => m.role === 'assistant').pop()
    expect(assistant).toBeTruthy()
    expect(Array.isArray(assistant!.questions)).toBe(true)
    expect(assistant!.questions!.length).toBeGreaterThan(0)
    expect(assistant!.meta?.['agentMode']).toBe('single')
    expect(assistant!.meta?.['provider']).toBeTruthy()
  })

  it('"ask 3 questions" returns exactly three structured questions', async () => {
    const app = createServer(db, new Date(), stateDir)
    const { body } = await startSession(app, 'do the thing')
    const ask = await app.inject({ method: 'POST', url: `/operator/sessions/${body.session.id}/ask`, payload: {} })
    const msgs = (ask.json() as { messages: Array<{ role: string; questions?: { id: string; options: { label: string }[] }[] }> }).messages
    const assistant = msgs.filter((m) => m.role === 'assistant' && m.questions?.length).pop()
    expect(assistant?.questions?.length).toBe(3)
  })

  it('answering questions records a user turn + event and reopens brainstorm_ready', async () => {
    const app = createServer(db, new Date(), stateDir)
    const { body } = await startSession(app, 'do the thing')
    const ask = await app.inject({ method: 'POST', url: `/operator/sessions/${body.session.id}/ask`, payload: {} })
    const q = (ask.json() as { messages: Array<{ role: string; questions?: { id: string; options: { label: string }[] }[] }> })
      .messages.filter((m) => m.role === 'assistant' && m.questions?.length).pop()!.questions!
    const answers = q.map((question) => ({ questionId: question.id, value: question.options[0]!.label }))
    const ans = await app.inject({ method: 'POST', url: `/operator/sessions/${body.session.id}/answer-questions`, payload: { answers } })
    expect(ans.statusCode).toBe(200)
    const out = ans.json() as { session: { status: string }; messages: Array<{ role: string; content: string }> }
    expect(out.session.status).toBe('brainstorm_ready')
    expect(out.messages.some((m) => m.role === 'user' && /Clarifications/.test(m.content))).toBe(true)
    expect(db.queryEvents({ type: 'operator.questions_answered', entityId: body.session.id })).toHaveLength(1)
  })

  it('answer-questions rejects an empty answer set', async () => {
    const app = createServer(db, new Date(), stateDir)
    const { body } = await startSession(app, 'do the thing')
    const ans = await app.inject({ method: 'POST', url: `/operator/sessions/${body.session.id}/answer-questions`, payload: { answers: [] } })
    expect(ans.statusCode).toBe(400)
  })

  it('surfaces active holds in the overview and clears them on resolve', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'draft' })
    const session = db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'p', status: 'roadmap_ready' })
    db.insertHold({ entityType: 'operator_session', entityId: session.id, code: 'HOLD-ROADMAP-PLANNER', reason: 'codex-cli timed out' })

    const ov1 = (await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })).json() as { activeHolds: { code: string }[] }
    expect(ov1.activeHolds.some((h) => h.code === 'HOLD-ROADMAP-PLANNER')).toBe(true)

    expect(db.resolveHold(session.id, 'HOLD-ROADMAP-PLANNER')).toBe(1)
    const ov2 = (await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })).json() as { activeHolds: { code: string }[] }
    expect(ov2.activeHolds).toHaveLength(0)
  })

  it('reports run progress and flags a stalled run', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'running' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 't', prompt: 'p', status: 'running', attemptNumber: 0 })
    const staleStart = new Date(Date.now() - 200_000).toISOString() // 200s ago > 90s default stall window
    db.insertRun({ taskId: task.id, runnerMode: 'codex-cli', status: 'running', startedAt: staleStart, evidenceDir: stateDir })

    const ov = (await app.inject({ method: 'GET', url: `/missions/${mission.id}/overview` })).json() as {
      runProgress: { status: string; stalled: boolean; runId: string } | null
    }
    expect(ov.runProgress).toBeTruthy()
    expect(ov.runProgress!.status).toBe('running')
    expect(ov.runProgress!.stalled).toBe(true)
  })
})
