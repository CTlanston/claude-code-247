import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import { DailySummaryGenerator } from './daily-summary.js'

let db: AedevDb
let summary: DailySummaryGenerator

beforeEach(() => {
  db = new AedevDb(':memory:')
  summary = new DailySummaryGenerator(db)
})

afterEach(() => {
  db.close()
})

describe('DailySummaryGenerator', () => {
  it('returns all zeros for an empty database', () => {
    const s = summary.stats({ date: '2026-05-25' })
    expect(s.missionsCreated).toBe(0)
    expect(s.tasksCreated).toBe(0)
    expect(s.runsStarted).toBe(0)
    expect(s.pendingApprovals).toBe(0)
  })

  it('renders "no activity" when nothing happened today', () => {
    const out = summary.render({ date: '2026-05-25' })
    expect(out).toContain('Daily Summary — 2026-05-25')
    expect(out).toContain('No activity recorded')
  })

  it('counts missions, tasks, runs, and pending approvals for the given date', () => {
    const today = new Date().toISOString().slice(0, 10)

    const repo = db.insertRepo({
      name: 'repo-1', path: '/tmp/r1', defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({ repoId: repo.id, title: 'T1', status: 'approved' })
    db.insertTask({ missionId: mission.id, repoId: repo.id, title: 'task A', prompt: 'do it', status: 'done', attemptNumber: 1 })
    db.insertTask({ missionId: mission.id, repoId: repo.id, title: 'task B', prompt: 'do it', status: 'pending', attemptNumber: 1 })

    const s = summary.stats({ date: today })
    expect(s.missionsCreated).toBeGreaterThanOrEqual(1)
    expect(s.tasksCreated).toBeGreaterThanOrEqual(2)
  })

  it('renders a non-empty summary with counts when activity exists', () => {
    const today = new Date().toISOString().slice(0, 10)
    const repo = db.insertRepo({
      name: 'repo-2', path: '/tmp/r2', defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const m = db.insertMission({ repoId: repo.id, title: 'T', status: 'approved' })
    db.insertTask({ missionId: m.id, repoId: repo.id, title: 'a', prompt: 'p', status: 'pending', attemptNumber: 1 })

    const md = summary.render({ date: today })
    expect(md).toContain('Daily Summary')
    expect(md).toContain('Missions')
    expect(md).toContain('Tasks')
    expect(md).not.toContain('No activity')
  })
})
