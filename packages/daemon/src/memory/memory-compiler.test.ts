import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import { MemoryCompiler } from './memory-compiler.js'

let db: AedevDb
beforeEach(() => { db = new AedevDb(':memory:') })
afterEach(() => db.close())

describe('MemoryCompiler', () => {
  it('createFromFailed creates a failure memory candidate', () => {
    const compiler = new MemoryCompiler(db)
    const item = compiler.createFromFailed({ symptom: 'Tests failed', errorMessage: 'AssertionError' })
    expect(item.type).toBe('failure')
    expect(item.approved).toBe(false)
    expect(item.content).toContain('Symptom: Tests failed')
    expect(item.content).toContain('AssertionError')
  })

  it('approved defaults to false (cannot execute before approval)', () => {
    const compiler = new MemoryCompiler(db)
    const item = compiler.createFromFailed({ symptom: 'Build failed' })
    expect(item.approved).toBe(false)
    expect(db.listMemoryItems({ approved: true })).toHaveLength(0)
  })

  it('scanAndCompile creates candidates from failed run events', () => {
    const repo = db.insertRepo({ name: 'r', path: '/tmp/r', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const mission = db.insertMission({ repoId: repo.id, title: 'M', status: 'approved' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 'T', prompt: 'do it', status: 'failed', attemptNumber: 0 })
    db.insertEvent('run.completed', 'run', 'run-1', { taskId: task.id, exitCode: 1, error: 'timeout' })

    const compiler = new MemoryCompiler(db)
    const created = compiler.scanAndCompile()
    expect(created).toHaveLength(1)
    expect(created[0]!.content).toContain('Symptom: Task "T" failed')
  })

  it('scanAndCompile skips tasks already in memory', () => {
    const repo = db.insertRepo({ name: 'r2', path: '/tmp/r2', defaultBranch: 'main', enabled: true, testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING' })
    const mission = db.insertMission({ repoId: repo.id, title: 'M2', status: 'approved' })
    const task = db.insertTask({ missionId: mission.id, repoId: repo.id, title: 'T2', prompt: 'do it', status: 'failed', attemptNumber: 0 })
    db.insertEvent('run.completed', 'run', 'run-2', { taskId: task.id, exitCode: 1 })

    const compiler = new MemoryCompiler(db)
    compiler.scanAndCompile()          // first scan
    const second = compiler.scanAndCompile() // second scan — should skip
    expect(second).toHaveLength(0)
  })
})
