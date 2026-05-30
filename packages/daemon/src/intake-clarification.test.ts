import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb } from '@aedev/core'
import { IntakeService } from './intake.js'
import { ClarificationGate } from './clarification-gate.js'

let db: AedevDb
let stateDir: string
let repoId: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-intake-clarif-'))
  repoId = db.insertRepo({
    name: 'demo', path: stateDir, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  }).id
})
afterEach(() => { db.close(); rmSync(stateDir, { recursive: true, force: true }) })

describe('IntakeService × ClarificationGate (ADR-0020 wiring)', () => {
  it('intercepts an ambiguous mission: emits clarification.requested + needsClarification=true', () => {
    const intake = new IntakeService(db, stateDir, new ClarificationGate(db, stateDir))
    const mission = intake.createMissionCandidate(repoId, 'improve everything and make the whole app better')
    expect(db.queryEvents({ type: 'mission.clarification.requested', entityId: mission.id })).toHaveLength(1)
    expect(intake.needsClarification(mission.id)).toBe(true)
  })

  it('does NOT gate a clear, well-scoped mission (no clarification events)', () => {
    const intake = new IntakeService(db, stateDir, new ClarificationGate(db, stateDir))
    const mission = intake.createMissionCandidate(
      repoId,
      'Add a "## Running the tests" section to README.md documenting the `node tests/run.js` command',
    )
    expect(db.queryEvents({ type: 'mission.clarification.requested', entityId: mission.id })).toHaveLength(0)
    expect(intake.needsClarification(mission.id)).toBe(false)
  })

  it('default IntakeService (no gate) never emits clarification events — behavior unchanged', () => {
    const intake = new IntakeService(db, stateDir)
    const mission = intake.createMissionCandidate(repoId, 'improve everything')
    expect(db.queryEvents({ type: 'mission.clarification.requested', entityId: mission.id })).toHaveLength(0)
    expect(intake.needsClarification(mission.id)).toBe(false)
  })
})
