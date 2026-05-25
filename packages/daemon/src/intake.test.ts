import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdirSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb } from '@aedev/core'
import { IntakeService } from './intake.js'

let db: AedevDb, stateDir: string, intake: IntakeService

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = join(tmpdir(), `aedev-intake-test-${Date.now()}`)
  mkdirSync(stateDir, { recursive: true })
  intake = new IntakeService(db, stateDir)
})

afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
})

describe('IntakeService', () => {
  it('createMissionCandidate creates a draft mission', () => {
    const m = intake.createMissionCandidate('repo-1', 'Add dark mode support')
    expect(m.status).toBe('draft')
    expect(m.title).toContain('Add dark mode')
  })

  it('canExecute returns false for a draft mission', () => {
    const m = intake.createMissionCandidate('repo-1', 'Fix login bug')
    expect(intake.canExecute(m.id)).toBe(false)
  })

  it('approveMission transitions mission to approved', () => {
    const m = intake.createMissionCandidate('repo-1', 'Refactor auth')
    const approved = intake.approveMission(m.id, 'operator')
    expect(approved.status).toBe('approved')
    expect(intake.canExecute(m.id)).toBe(true)
  })

  it('PRD template file is created', () => {
    const m = intake.createMissionCandidate('repo-1', 'Add search')
    const content = intake.getPrdContent(m.id)
    expect(content).toBeDefined()
    expect(content).toContain('PRD')
    expect(content).toContain('Add search')
  })
})
