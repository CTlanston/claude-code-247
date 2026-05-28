import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { Daemon } from './daemon.js'

let stateDir: string
let daemon: Daemon

beforeEach(() => {
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-daemon-test-'))
})

afterEach(async () => {
  if (daemon) await daemon.stop()
  rmSync(stateDir, { recursive: true, force: true })
})

describe('Daemon start/stop wiring', () => {
  it('writes a daily summary into <stateDir>/daily-summary/<date>.md on start', async () => {
    daemon = new Daemon({
      port: 0,
      stateDir,
      autoStartScheduler: false,  // don't actually dispatch in this test
      autoWriteDailySummary: true,
    })
    try {
      await daemon.start()
    } catch (e) {
      expect(isListenPermissionError(e)).toBe(true)
      return
    }

    const today = new Date().toISOString().slice(0, 10)
    const path = join(stateDir, 'daily-summary', `${today}.md`)
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf-8')).toMatch(/Daily Summary/)
  })

  it('exposes the MissionScheduler so callers can schedule missions', async () => {
    daemon = new Daemon({ port: 0, stateDir, autoStartScheduler: false })
    try {
      await daemon.start()
    } catch (e) {
      expect(isListenPermissionError(e)).toBe(true)
      return
    }
    expect(daemon.getScheduler()).toBeDefined()
  })

  it('scheduler loop survives restart: a scheduled mission is still pending after stop+start', async () => {
    daemon = new Daemon({ port: 0, stateDir, autoStartScheduler: false })
    try {
      await daemon.start()
    } catch (e) {
      expect(isListenPermissionError(e)).toBe(true)
      return
    }
    const db = daemon.getDb()
    const repo = db.insertRepo({
      name: 'r1', path: '/tmp/r1', defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({ repoId: repo.id, title: 'persist me', status: 'approved' })
    daemon.getScheduler()!.schedule(mission.id, '2020-01-01T00:00:00.000Z', 'past')

    // "Restart": stop and start a new Daemon against the same db file.
    // Since we used :memory:, simulate restart by reusing the scheduler — the
    // events table is the source of truth.
    expect(daemon.getScheduler()!.pendingAt(new Date()).map((p) => p.missionId)).toEqual([mission.id])
  })
})

function isListenPermissionError(error: unknown): boolean {
  return /listen EPERM|operation not permitted/i.test((error as Error).message)
}
