import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb } from '@aedev/core'
import { RunnerManager } from './runner-manager.js'

let db: AedevDb, outputDir: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  outputDir = join(tmpdir(), `rm-test-${Date.now()}`)
})
afterEach(() => {
  db.close()
  rmSync(outputDir, { recursive: true, force: true })
})

describe('RunnerManager', () => {
  it('runTask transitions task from pending to done', async () => {
    // Setup: insert repo, mission, task
    const repo = db.insertRepo({ name: 'r', path: '/tmp/r', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const mission = db.insertMission({ repoId: repo.id, title: 'M', status: 'approved' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 'T', prompt: 'do it', status: 'pending', attemptNumber: 0 })

    const config = { mode: 'mock' as const, maxConcurrentWorkers: 1, worktreeBaseDir: outputDir, outputBaseDir: outputDir }
    const mgr = new RunnerManager(db, config)
    const result = await mgr.runTask(task)

    expect(result.exitCode).toBe(0)
    const updated = db.getTask(task.id)
    expect(updated?.status).toBe('done')
  })

  it('throws if task is not in pending state', async () => {
    const repo = db.insertRepo({ name: 'r2', path: '/tmp/r2', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const mission = db.insertMission({ repoId: repo.id, title: 'M2', status: 'approved' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 'T2', prompt: 'do it', status: 'running', attemptNumber: 0 })
    const config = { mode: 'mock' as const, maxConcurrentWorkers: 1, worktreeBaseDir: outputDir, outputBaseDir: outputDir }
    const mgr = new RunnerManager(db, config)
    await expect(mgr.runTask(task)).rejects.toThrow('not in pending state')
  })
})
