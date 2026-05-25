import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import { MissionScheduler } from './mission-scheduler.js'

let db: AedevDb
let scheduler: MissionScheduler
let repoId: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  const repo = db.insertRepo({
    name: 'repo-1', path: '/tmp/r1', defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  })
  repoId = repo.id
  scheduler = new MissionScheduler(db)
})

afterEach(() => {
  db.close()
})

describe('MissionScheduler', () => {
  it('returns an empty pending list initially', () => {
    expect(scheduler.pendingAt(new Date())).toEqual([])
  })

  it('returns missions whose scheduledFor is in the past', () => {
    const m = db.insertMission({ repoId, title: 'm1', status: 'approved' })
    scheduler.schedule(m.id, '2020-01-01T00:00:00.000Z', 'past schedule')

    const pending = scheduler.pendingAt(new Date('2026-01-01'))
    expect(pending).toHaveLength(1)
    expect(pending[0]?.missionId).toBe(m.id)
    expect(pending[0]?.reason).toBe('past schedule')
  })

  it('does NOT return missions whose scheduledFor is in the future', () => {
    const m = db.insertMission({ repoId, title: 'm-future', status: 'approved' })
    scheduler.schedule(m.id, '2099-12-31T00:00:00.000Z')
    expect(scheduler.pendingAt(new Date())).toEqual([])
  })

  it('honors cancel() — a later cancel event removes the mission from pending', () => {
    const m = db.insertMission({ repoId, title: 'm-cancel', status: 'approved' })
    scheduler.schedule(m.id, '2020-01-01T00:00:00.000Z')
    expect(scheduler.pendingAt(new Date()).length).toBe(1)
    scheduler.cancel(m.id)
    expect(scheduler.pendingAt(new Date())).toEqual([])
  })

  it('reschedule (a second schedule event) overrides the first', () => {
    const m = db.insertMission({ repoId, title: 'm-reschedule', status: 'approved' })
    scheduler.schedule(m.id, '2020-01-01T00:00:00.000Z')
    scheduler.schedule(m.id, '2099-12-31T00:00:00.000Z')
    expect(scheduler.pendingAt(new Date())).toEqual([])
  })

  it('tick() dispatches pending missions and clears them', async () => {
    const m1 = db.insertMission({ repoId, title: 'm1', status: 'approved' })
    const m2 = db.insertMission({ repoId, title: 'm2', status: 'approved' })
    scheduler.schedule(m1.id, '2020-01-01T00:00:00.000Z')
    scheduler.schedule(m2.id, '2020-01-01T00:00:00.000Z')

    const dispatched: string[] = []
    const result = await scheduler.tick(async (m) => { dispatched.push(m.id) })

    expect(result.dispatched).toBe(2)
    expect(dispatched.sort()).toEqual([m1.id, m2.id].sort())
    // After dispatch, the schedule is cleared
    expect(scheduler.pendingAt(new Date())).toEqual([])
  })

  it('tick() captures dispatcher errors without halting the loop', async () => {
    const m1 = db.insertMission({ repoId, title: 'm1', status: 'approved' })
    const m2 = db.insertMission({ repoId, title: 'm2', status: 'approved' })
    scheduler.schedule(m1.id, '2020-01-01T00:00:00.000Z')
    scheduler.schedule(m2.id, '2020-01-01T00:00:00.000Z')

    const result = await scheduler.tick(async (m) => {
      if (m.id === m1.id) throw new Error('boom')
    })

    expect(result.dispatched).toBe(1)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0]?.missionId).toBe(m1.id)
    // Errored mission stays pending; successful one is cleared
    const stillPending = scheduler.pendingAt(new Date())
    expect(stillPending.map((p) => p.missionId)).toEqual([m1.id])
  })

  it('schedules persist across "restart" (new scheduler instance, same db)', () => {
    const m = db.insertMission({ repoId, title: 'm-restart', status: 'approved' })
    scheduler.schedule(m.id, '2020-01-01T00:00:00.000Z')

    // "Restart" by constructing a fresh scheduler against the same DB.
    const restarted = new MissionScheduler(db)
    expect(restarted.pendingAt(new Date()).map((p) => p.missionId)).toEqual([m.id])
  })

  it('runLoop processes ticks then stops at maxTicks (injectable sleep keeps it fast)', async () => {
    const m = db.insertMission({ repoId, title: 'm-loop', status: 'approved' })
    scheduler.schedule(m.id, '2020-01-01T00:00:00.000Z')

    let sleeps = 0
    const fastScheduler = new MissionScheduler(db, { sleepFn: async () => { sleeps++ }, tickIntervalMs: 100 })
    const result = await fastScheduler.runLoop(async () => {}, 3)
    expect(result.ticks).toBe(3)
    expect(result.totalDispatched).toBeGreaterThanOrEqual(1)
    expect(sleeps).toBeGreaterThan(0)
  })
})
