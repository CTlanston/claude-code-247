import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb } from '@aedev/core'
import { HEADLESS_CALL_EVENT } from './headless-budget-guard.js'
import { Watchdog, WATCHDOG_TICK_EVENT } from './watchdog.js'

let db: AedevDb
let tmp: string
let notifications: Array<{ title: string; body: string }>

function makeWatchdog(opts: { now?: () => Date; compileHour?: number; staleMinutes?: number } = {}): Watchdog {
  return new Watchdog({
    db,
    notify: async (title, body) => { notifications.push({ title, body }) },
    homeDir: tmp,
    ...opts,
  })
}

beforeEach(() => {
  db = new AedevDb(':memory:')
  tmp = join(tmpdir(), `aedev-watchdog-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(tmp, { recursive: true })
  notifications = []
})

afterEach(() => {
  db.close()
  rmSync(tmp, { recursive: true, force: true })
})

describe('Watchdog (P3)', () => {
  it('a quiet tick is silent: no notifications, no LLM calls, only the tick event', async () => {
    const report = await makeWatchdog({ compileHour: 23, now: () => new Date('2026-06-10T08:00:00') }).tick()
    expect(report.quiet).toBe(true)
    expect(notifications).toHaveLength(0)
    expect(db.queryEvents({ type: HEADLESS_CALL_EVENT })).toHaveLength(0)
    expect(db.queryEvents({ type: 'operator.notify_requested' })).toHaveLength(0)
    expect(db.queryEvents({ type: WATCHDOG_TICK_EVENT })).toHaveLength(1)
  })

  it('notifies holds created since the last tick exactly once, and skips historical holds on the first tick', async () => {
    db.insertEvent('operator.hold_created', 'operator_session', 's-old', { holdCode: 'HOLD-OLD', reason: 'pre-existing' })
    const wd = makeWatchdog({ compileHour: 23, now: () => new Date('2026-06-10T08:00:00') })
    const first = await wd.tick()
    expect(first.newHoldsNotified).toBe(0) // no window before the first tick → no historical blast

    db.insertEvent('operator.hold_created', 'operator_session', 's-new', { holdCode: 'HOLD-BUDGET', reason: 'cap reached' })
    const second = await wd.tick()
    expect(second.newHoldsNotified).toBe(1)
    expect(notifications[0]!.title).toContain('HOLD-BUDGET')
    expect(db.queryEvents({ type: 'watchdog.hold_notified', entityId: 's-new' })).toHaveLength(1)

    const third = await wd.tick()
    expect(third.newHoldsNotified).toBe(0) // not re-notified
  })

  it('flags a stale running mission once, deduped across ticks', async () => {
    const repoId = db.insertRepo({
      name: 'r', path: tmp, defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'low-risk',
    }).id
    const mission = db.insertMission({ repoId, title: 'stuck', description: 'd', status: 'draft' })
    db.updateMissionStatus(mission.id, 'running')

    const future = () => new Date(Date.now() + 2 * 60 * 60 * 1000) // 2h later: well past staleMinutes
    const wd = makeWatchdog({ compileHour: 23, now: future, staleMinutes: 45 })
    const first = await wd.tick()
    expect(first.staleMissionsNotified).toBe(1)
    expect(notifications.some((n) => n.title.includes('stale'))).toBe(true)
    const second = await wd.tick()
    expect(second.staleMissionsNotified).toBe(0)
  })

  it('runs the nightly Memory Compiler once per day at/after the compile hour and updates Tier-1', async () => {
    const repoDir = join(tmp, 'repo')
    mkdirSync(repoDir, { recursive: true })
    const repoId = db.insertRepo({
      name: 'memrepo', path: repoDir, defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'low-risk',
    }).id
    const mission = db.insertMission({ repoId, title: 'm', description: 'd', status: 'draft' })
    db.insertEvent('operator.gemini_pr_blocked', 'mission', mission.id, { reason: 'tests are fake', summary: 'fake tests' })

    const at3am = () => new Date('2026-06-10T03:30:00')
    const wd = makeWatchdog({ compileHour: 2, now: at3am })
    const first = await wd.tick()
    expect(first.memoryCompiledRepos).toBe(1)
    const tier1 = join(repoDir, '.aedev', 'cowork-memory.md')
    expect(existsSync(tier1)).toBe(true)
    expect(readFileSync(tier1, 'utf8')).toMatch(/tests are fake/)

    const second = await wd.tick()
    expect(second.memoryCompiledRepos).toBe(0) // once per calendar day

    const beforeHour = await makeWatchdog({ compileHour: 23, now: () => new Date('2026-06-11T08:00:00') }).tick()
    expect(beforeHour.memoryCompiledRepos).toBe(0) // next day but before the hour
  })

  it('start/stop: the stop signal interrupts the tick sleep immediately', async () => {
    const wd = makeWatchdog({ compileHour: 23 })
    wd.start()
    const stopped = wd.stop()
    await expect(Promise.race([
      stopped.then(() => 'stopped'),
      new Promise((r) => setTimeout(() => r('hung'), 500)),
    ])).resolves.toBe('stopped')
  })
})
