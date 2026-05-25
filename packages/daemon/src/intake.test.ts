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

describe('IntakeService — draft lifecycle', () => {
  it('createMissionCandidate creates a draft mission', () => {
    const m = intake.createMissionCandidate('repo-1', 'Add dark mode support')
    expect(m.status).toBe('draft')
    expect(m.title).toContain('Add dark mode')
  })

  it('draft mission is NOT executable', () => {
    const m = intake.createMissionCandidate('repo-1', 'Fix login bug')
    expect(intake.canExecute(m.id)).toBe(false)
  })

  it('PRD template file is created', () => {
    const m = intake.createMissionCandidate('repo-1', 'Add search')
    const content = intake.getPrdContent(m.id)
    expect(content).toBeDefined()
    expect(content).toContain('PRD')
    expect(content).toContain('Add search')
  })
})

describe('IntakeService — approval gate (two-step, no self-approval)', () => {
  it('requestApproval moves draft → pending_approval', () => {
    const m = intake.createMissionCandidate('repo-1', 'Refactor auth')
    const pending = intake.requestApproval(m.id)
    expect(pending.status).toBe('pending_approval')
  })

  it('pending_approval mission is NOT executable', () => {
    const m = intake.createMissionCandidate('repo-1', 'Refactor auth')
    intake.requestApproval(m.id)
    expect(intake.canExecute(m.id)).toBe(false)
  })

  it('approveMission without prior requestApproval throws (no self-approval)', () => {
    const m = intake.createMissionCandidate('repo-1', 'Risky change')
    // Should throw because status is 'draft', not 'pending_approval'
    expect(() => intake.approveMission(m.id, 'operator')).toThrow(/pending_approval/)
  })

  it('approveMission after requestApproval moves → approved', () => {
    const m = intake.createMissionCandidate('repo-1', 'Add feature')
    intake.requestApproval(m.id)
    const approved = intake.approveMission(m.id, 'operator')
    expect(approved.status).toBe('approved')
  })

  it('only after explicit approveMission is mission executable', () => {
    const m = intake.createMissionCandidate('repo-1', 'Add feature')
    expect(intake.canExecute(m.id)).toBe(false)        // draft
    intake.requestApproval(m.id)
    expect(intake.canExecute(m.id)).toBe(false)        // pending_approval
    intake.approveMission(m.id, 'operator')
    expect(intake.canExecute(m.id)).toBe(true)         // approved
  })

  it('cannot call requestApproval on an already-pending mission', () => {
    const m = intake.createMissionCandidate('repo-1', 'Some task')
    intake.requestApproval(m.id)
    // State machine should reject draft→pending_approval again
    expect(() => intake.requestApproval(m.id)).toThrow()
  })
})
