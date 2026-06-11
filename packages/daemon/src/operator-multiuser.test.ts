import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { createServer } from './server.js'

// CloudHull Cycle 5 — smallest safe multi-user prototype (trusted-local users
// on one shared Mac; Tailscale LAN; NO SaaS auth).
//
//  - POST /operator/sessions accepts an optional `submittedBy` display name
//    (trimmed, ≤40 chars, credential-looking names red-lined → 400).
//  - The `x-aedev-user` header is a PLAIN trusted-local display-name header,
//    explicitly NOT authentication; absent header = owner (backward compat).
//  - approve-roadmap / start / create-pr are owner-only gates: a non-owner
//    display name gets a calm bilingual 403, never enacted state.
//
// Deterministic: VITEST makes the planner synthetic — no real CLI is hit.

let db: AedevDb
let stateDir: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-operator-multiuser-'))
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
})

function makeRepo() {
  return db.insertRepo({
    name: 'multiuser-test', path: stateDir, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
}

function markClarifyUnlocked(sessionId: string): void {
  db.insertEvent('clarify.confidence', 'operator_session', sessionId, {
    role: 'planner', confidence: 96, threshold: 95, rationale: 'Test fixture is pre-clarified.',
  })
}

describe('cloudhull-c5 · submittedBy on session creation', () => {
  it('persists a trimmed submittedBy, returns it on GET/list, and audits it in operator.session.created', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const res = await app.inject({
      method: 'POST', url: '/operator/sessions',
      payload: { repoId: repo.id, title: 'T', prompt: 'add a focused unit test for the parser', submittedBy: '  Alice  ' },
    })
    expect(res.statusCode).toBe(200)
    const { session } = res.json() as { session: { id: string; submittedBy?: string } }
    expect(session.submittedBy).toBe('Alice')

    const got = (await app.inject({ method: 'GET', url: `/operator/sessions/${session.id}` })).json() as { session: { submittedBy?: string } }
    expect(got.session.submittedBy).toBe('Alice')

    const list = (await app.inject({ method: 'GET', url: '/operator/sessions' })).json() as { sessions: Array<{ id: string; submittedBy?: string }> }
    expect(list.sessions.find((s) => s.id === session.id)?.submittedBy).toBe('Alice')

    const [created] = db.queryEvents({ type: 'operator.session.created', entityId: session.id })
    expect(created).toBeTruthy()
    expect(created!.payload['submittedBy']).toBe('Alice')
  })

  it('backfills submittedBy as "owner" when not provided (backward compat)', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const res = await app.inject({
      method: 'POST', url: '/operator/sessions',
      payload: { repoId: repo.id, title: 'T', prompt: 'add a focused unit test for the parser' },
    })
    expect(res.statusCode).toBe(200)
    const { session } = res.json() as { session: { id: string; submittedBy?: string } }
    expect(session.submittedBy).toBe('owner')
    const [created] = db.queryEvents({ type: 'operator.session.created', entityId: session.id })
    expect(created!.payload['submittedBy']).toBe('owner')
  })

  it('rejects submittedBy longer than 40 chars with a 400', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const res = await app.inject({
      method: 'POST', url: '/operator/sessions',
      payload: { repoId: repo.id, title: 'T', prompt: 'p', submittedBy: 'x'.repeat(41) },
    })
    expect(res.statusCode).toBe(400)
    expect(db.listOperatorSessions()).toHaveLength(0)
  })

  it.each(['my token', 'API-Key man', 'api_key holder', 'secretive'])(
    'red-lines credential-looking display name %j with a 400',
    async (name) => {
      const app = createServer(db, new Date(), stateDir)
      const repo = makeRepo()
      const res = await app.inject({
        method: 'POST', url: '/operator/sessions',
        payload: { repoId: repo.id, title: 'T', prompt: 'p', submittedBy: name },
      })
      expect(res.statusCode).toBe(400)
      expect(db.listOperatorSessions()).toHaveLength(0)
    },
  )
})

describe('cloudhull-c5 · x-aedev-user records the acting display name (NOT auth)', () => {
  it('records answeredBy on operator.questions_answered when the header is present', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const create = await app.inject({
      method: 'POST', url: '/operator/sessions',
      payload: { repoId: repo.id, title: 'T', prompt: 'improve everything in the whole project' },
    })
    const body = create.json() as { session: { id: string }; messages: Array<{ role: string; questions?: Array<{ id: string; options: Array<{ label: string }> }> }> }
    const questions = body.messages.filter((m) => m.role === 'assistant' && m.questions?.length).pop()!.questions!
    const answers = questions.map((q) => ({ questionId: q.id, value: q.options[0]!.label }))
    const res = await app.inject({
      method: 'POST', url: `/operator/sessions/${body.session.id}/answer-questions`,
      headers: { 'x-aedev-user': 'Bob' },
      payload: { answers },
    })
    expect(res.statusCode).toBe(200)
    const [event] = db.queryEvents({ type: 'operator.questions_answered', entityId: body.session.id })
    expect(event!.payload['answeredBy']).toBe('Bob')
    expect(event!.operatorId).toBe('Bob')
  })
})

describe('cloudhull-c5 · owner-only gates (approve-roadmap / start / create-pr)', () => {
  function makeMissionSession(missionStatus: 'draft' | 'approved') {
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: missionStatus })
    const session = db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'p', status: 'roadmap_ready' })
    return { repo, mission, session }
  }

  it.each(['approve-roadmap', 'start', 'create-pr'] as const)(
    'returns a calm bilingual 403 to a non-owner on %s (no raw codes in guidance)',
    async (action) => {
      const app = createServer(db, new Date(), stateDir)
      const { mission, session } = makeMissionSession('draft')
      const res = await app.inject({
        method: 'POST', url: `/operator/sessions/${session.id}/${action}`,
        headers: { 'x-aedev-user': 'mallory' },
        payload: {},
      })
      expect(res.statusCode).toBe(403)
      const body = res.json() as { humanState?: string; guidance?: string; ownerName?: string }
      expect(body.humanState).toBe('waiting_for_approval')
      expect(body.guidance).toContain('这一步需要 Owner 执行')
      expect(body.guidance).toMatch(/owner/i)
      expect(body.guidance).not.toMatch(/403|FORBIDDEN|OWNER_REQUIRED/)
      expect(body.ownerName).toBe('owner')
      // No enacted state: the mission did not move.
      expect(db.getMission(mission.id)!.status).toBe('draft')
      // The refusal is audited with the acting display name.
      const refusals = db.queryEvents({ type: 'operator.owner_gate_refused', entityId: session.id })
      expect(refusals.length).toBeGreaterThan(0)
      expect(refusals[0]!.payload['actor']).toBe('mallory')
      expect(refusals[0]!.payload['action']).toBe(action)
    },
  )

  it('lets the owner header pass approve-roadmap and audits the acting name', async () => {
    const app = createServer(db, new Date(), stateDir)
    const { mission, session } = makeMissionSession('draft')
    const res = await app.inject({
      method: 'POST', url: `/operator/sessions/${session.id}/approve-roadmap`,
      headers: { 'x-aedev-user': 'owner' },
      payload: {},
    })
    expect(res.statusCode).toBe(200)
    expect(db.getMission(mission.id)!.status).toBe('approved')
    const [event] = db.queryEvents({ type: 'operator.approval_recorded', entityId: mission.id })
    expect(event!.payload['actor']).toBe('owner')
  })

  it('keeps the absent-header path working as owner (backward compat: start runs)', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const mission = db.insertMission({ repoId: repo.id, title: 'M', description: 'd', status: 'approved' })
    const session = db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'M', prompt: 'p', status: 'approved' })
    markClarifyUnlocked(session.id)
    const res = await app.inject({ method: 'POST', url: `/operator/sessions/${session.id}/start` })
    expect(res.statusCode).toBe(200)
    expect(db.queryEvents({ type: 'operator.run_starting', entityId: mission.id })).toHaveLength(1)
  })

  it('respects AEDEV_OWNER_NAME: the configured owner passes, the default name does not', async () => {
    const prev = process.env['AEDEV_OWNER_NAME']
    process.env['AEDEV_OWNER_NAME'] = 'lan'
    try {
      const app = createServer(db, new Date(), stateDir)
      const { mission, session } = makeMissionSession('draft')
      const refused = await app.inject({
        method: 'POST', url: `/operator/sessions/${session.id}/approve-roadmap`,
        headers: { 'x-aedev-user': 'owner' },
        payload: {},
      })
      expect(refused.statusCode).toBe(403)
      expect((refused.json() as { ownerName?: string }).ownerName).toBe('lan')
      expect(db.getMission(mission.id)!.status).toBe('draft')

      const allowed = await app.inject({
        method: 'POST', url: `/operator/sessions/${session.id}/approve-roadmap`,
        headers: { 'x-aedev-user': 'lan' },
        payload: {},
      })
      expect(allowed.statusCode).toBe(200)
      expect(db.getMission(mission.id)!.status).toBe('approved')
    } finally {
      if (prev === undefined) delete process.env['AEDEV_OWNER_NAME']
      else process.env['AEDEV_OWNER_NAME'] = prev
    }
  })

  it('keeps submitting sessions and answering clarifications open to non-owners', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const res = await app.inject({
      method: 'POST', url: '/operator/sessions',
      headers: { 'x-aedev-user': 'Bob' },
      payload: { repoId: repo.id, title: 'T', prompt: 'add a focused unit test', submittedBy: 'Bob' },
    })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { session: { submittedBy?: string } }).session.submittedBy).toBe('Bob')
  })
})

describe('cloudhull-c5 · GET /status exposes ownerName', () => {
  it('defaults ownerName to "owner"', async () => {
    const app = createServer(db, new Date(), stateDir)
    const res = await app.inject({ method: 'GET', url: '/status' })
    expect(res.statusCode).toBe(200)
    expect((res.json() as { ownerName?: string }).ownerName).toBe('owner')
  })

  it('reflects AEDEV_OWNER_NAME', async () => {
    const prev = process.env['AEDEV_OWNER_NAME']
    process.env['AEDEV_OWNER_NAME'] = 'lan'
    try {
      const app = createServer(db, new Date(), stateDir)
      const res = await app.inject({ method: 'GET', url: '/status' })
      expect((res.json() as { ownerName?: string }).ownerName).toBe('lan')
    } finally {
      if (prev === undefined) delete process.env['AEDEV_OWNER_NAME']
      else process.env['AEDEV_OWNER_NAME'] = prev
    }
  })
})
