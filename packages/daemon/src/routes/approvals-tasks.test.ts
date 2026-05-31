import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { createServer } from '../server.js'
import { IntakeService } from '../intake.js'

let db: AedevDb
let stateDir: string

function makeRepo(name = 'enrich-test') {
  return db.insertRepo({
    name, path: stateDir, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
}

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-enrich-'))
})
afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
})

describe('GET /approvals — enriched workbench', () => {
  it('enriches mission approvals with mission title, repo, session, and age', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo('approvals-repo')
    const intake = new IntakeService(db, stateDir)
    const mission = intake.createMissionCandidate(repo.id, 'Add a docs line', 'Docs mission')
    intake.requestApproval(mission.id)
    db.insertOperatorSession({ repoId: repo.id, missionId: mission.id, title: 'Docs mission', prompt: 'p', status: 'roadmap_ready' })

    const res = await app.inject({ method: 'GET', url: '/approvals' })
    const { approvals } = res.json() as { approvals: Array<{ status: string; mission?: { title: string }; repo?: { name: string }; sessionId?: string; ageMs: number }> }
    const pending = approvals.find((a) => a.status === 'pending')
    expect(pending).toBeTruthy()
    expect(pending!.mission?.title).toBe('Docs mission')
    expect(pending!.repo?.name).toBe('approvals-repo')
    expect(pending!.sessionId).toBeTruthy()
    expect(typeof pending!.ageMs).toBe('number')
  })

  it('approve decision transitions the mission to approved and marks the record approved', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const intake = new IntakeService(db, stateDir)
    const mission = intake.createMissionCandidate(repo.id, 'Do thing', 'Mission')
    intake.requestApproval(mission.id)
    const approvalId = db.listApprovals('pending')[0]!.id

    const res = await app.inject({ method: 'POST', url: `/approvals/${approvalId}/decision`, payload: { decision: 'approve' } })
    expect(res.statusCode).toBe(200)
    expect(db.getMission(mission.id)!.status).toBe('approved')
    expect(db.listApprovals().find((a) => a.id === approvalId)!.status).toBe('approved')
  })

  it('reject decision closes the approval as rejected', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const intake = new IntakeService(db, stateDir)
    const mission = intake.createMissionCandidate(repo.id, 'Do thing', 'Mission')
    intake.requestApproval(mission.id)
    const approvalId = db.listApprovals('pending')[0]!.id

    const res = await app.inject({ method: 'POST', url: `/approvals/${approvalId}/decision`, payload: { decision: 'reject', notes: 'no' } })
    expect(res.statusCode).toBe(200)
    expect(db.listApprovals().find((a) => a.id === approvalId)!.status).toBe('rejected')
    expect(db.getMission(mission.id)!.status).toBe('pending_approval') // not approved
  })

  it('404s an unknown approval id', async () => {
    const app = createServer(db, new Date(), stateDir)
    const res = await app.inject({ method: 'POST', url: '/approvals/nope/decision', payload: { decision: 'approve' } })
    expect(res.statusCode).toBe(404)
  })
})

describe('GET /tasks — live execution view', () => {
  it('enriches tasks with mission/repo/latest run and puts running tasks first', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo('tasks-repo')
    const mission = db.insertMission({ repoId: repo.id, title: 'Task mission', description: 'd', status: 'running' })
    const doneTask = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 'done one', prompt: 'p', status: 'done', attemptNumber: 1 })
    db.insertRun({ taskId: doneTask.id, runnerMode: 'codex-cli', status: 'done', exitCode: 0, evidenceDir: stateDir })
    const runningTask = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 'running one', prompt: 'p', status: 'running', attemptNumber: 1 })
    db.insertRun({ taskId: runningTask.id, runnerMode: 'codex-cli', status: 'running', evidenceDir: stateDir })

    const res = await app.inject({ method: 'GET', url: '/tasks' })
    const { tasks } = res.json() as { tasks: Array<{ id: string; status: string; missionTitle: string; repoName: string; latestRun: { status: string } | null }> }
    expect(tasks[0]!.status).toBe('running') // running first
    expect(tasks[0]!.missionTitle).toBe('Task mission')
    expect(tasks[0]!.repoName).toBe('tasks-repo')
    expect(tasks[0]!.latestRun?.status).toBe('running')
  })

  it('filters by missionId', async () => {
    const app = createServer(db, new Date(), stateDir)
    const repo = makeRepo()
    const m1 = db.insertMission({ repoId: repo.id, title: 'M1', description: 'd', status: 'running' })
    const m2 = db.insertMission({ repoId: repo.id, title: 'M2', description: 'd', status: 'running' })
    db.insertTask({ missionId: m1.id, repoId: repo.id, title: 't1', prompt: 'p', status: 'pending', attemptNumber: 1 })
    db.insertTask({ missionId: m2.id, repoId: repo.id, title: 't2', prompt: 'p', status: 'pending', attemptNumber: 1 })

    const res = await app.inject({ method: 'GET', url: `/tasks?missionId=${m1.id}` })
    const { tasks } = res.json() as { tasks: Array<{ missionId: string }> }
    expect(tasks).toHaveLength(1)
    expect(tasks[0]!.missionId).toBe(m1.id)
  })
})
