import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb, type MissionDesign } from '@aedev/core'
import {
  ClarificationGate, scoreAmbiguity, renderClarifiedSpec,
  DEFAULT_CLARIFICATION_POLICY, type ClarificationAnswer,
} from './clarification-gate.js'

let db: AedevDb
let stateDir: string
let repoId: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = mkdtempSync(join(tmpdir(), 'aedev-clarif-'))
  repoId = db.insertRepo({
    name: 'r', path: stateDir, defaultBranch: 'main', enabled: true,
    testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
  }).id
})
afterEach(() => { db.close(); rmSync(stateDir, { recursive: true, force: true }) })

function design(acceptanceCriteria: string[]): MissionDesign {
  return {
    missionId: 'm', title: 't',
    prd: {
      summary: 's', goals: ['g'], nonGoals: [], acceptanceCriteria,
      risks: [], rollbackPlan: 'r', documentationImpact: 'd',
    },
    adrDraft: { title: 'a', context: 'c', decision: 'd', consequences: 'q' },
    roadmap: ['r1'], checkpoints: [],
    taskDag: [{ id: 't1', title: 'x', role: 'coder', parentIds: [], contextFiles: [], writeFiles: [], expectedEvidence: [], checkpointGate: null }],
  }
}

describe('scoreAmbiguity', () => {
  it('scores a clear, well-specified mission BELOW threshold (no over-gating)', () => {
    const r = scoreAmbiguity(
      { title: 'Add Running the tests section to README.md', description: 'Add a "## Running the tests" section to README.md documenting `node tests/run.js`.' },
      design(['README.md contains a "## Running the tests" heading documenting node tests/run.js']),
    )
    expect(r.score).toBeLessThan(DEFAULT_CLARIFICATION_POLICY.triggerThreshold)
    expect(r.reasons).toHaveLength(0)
  })

  it('scores a vague, unscoped mission ABOVE threshold with reasons', () => {
    const r = scoreAmbiguity(
      { title: 'make the dashboard better', description: 'improve everything and polish the whole app' },
      design([]),
    )
    expect(r.score).toBeGreaterThanOrEqual(DEFAULT_CLARIFICATION_POLICY.triggerThreshold)
    expect(r.reasons.length).toBeGreaterThan(0)
    expect(r.missing).toContain('acceptance-criteria')
  })

  it('flags placeholder acceptance criteria as not verifiable', () => {
    const r = scoreAmbiguity(
      { title: 'fix things in src/app.ts', description: 'fix the bug in `src/app.ts`' },
      design(['TBD', 'it works']),
    )
    expect(r.missing).toContain('acceptance-criteria')
  })
})

describe('ClarificationGate', () => {
  it('does NOT gate a clear mission (required=false, no events)', () => {
    const gate = new ClarificationGate(db, stateDir)
    const ev = gate.evaluate(
      { title: 'Add tests/foo.test.js', description: 'Add a unit test in `tests/foo.test.js` that asserts add(2,3)===5' },
      design(['tests/foo.test.js passes asserting add(2,3) returns 5']),
    )
    expect(ev.required).toBe(false)
    expect(ev.questions).toHaveLength(0)
  })

  it('gates an ambiguous mission and asks <= maxQuestions structured questions', () => {
    const gate = new ClarificationGate(db, stateDir)
    const ev = gate.evaluate({ title: 'improve stuff', description: 'make everything better' }, design([]))
    expect(ev.required).toBe(true)
    expect(ev.questions.length).toBeGreaterThanOrEqual(1)
    expect(ev.questions.length).toBeLessThanOrEqual(DEFAULT_CLARIFICATION_POLICY.maxQuestions)
    for (const q of ev.questions) {
      expect(q.choices.length).toBeGreaterThanOrEqual(2)
      expect(q.recommendedDefault.length).toBeGreaterThan(0)
    }
    // Regression: question IDs must be unique within a set (a ULID-slice bug
    // previously collided same-ms IDs, making the spec render dedupe answers).
    const ids = ev.questions.map((q) => q.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('request() emits mission.clarification.requested and persists questions', () => {
    const mission = db.insertMission({ repoId, title: 'improve stuff', description: 'make everything better', status: 'draft' })
    const gate = new ClarificationGate(db, stateDir)
    const ev = gate.evaluate({ title: mission.title, description: mission.description }, design([]))
    gate.request(mission.id, ev)
    const events = db.queryEvents({ type: 'mission.clarification.requested' })
    expect(events).toHaveLength(1)
    expect(events[0]?.payload['questionCount']).toBe(ev.questions.length)
    expect(existsSync(join(stateDir, 'clarification', mission.id, 'questions.json'))).toBe(true)
    expect(gate.status(mission.id)).toBe('requested')
  })

  it('resolve() emits answered+resolved and writes a verifiable clarified-spec.md', () => {
    const mission = db.insertMission({ repoId, title: 'improve stuff', description: 'make everything better', status: 'draft' })
    const gate = new ClarificationGate(db, stateDir)
    const ev = gate.evaluate({ title: mission.title, description: mission.description }, design([]))
    gate.request(mission.id, ev)
    const answers: ClarificationAnswer[] = ev.questions.map((q) => ({
      questionId: q.id, field: q.field, answer: `answer for ${q.field}`,
    }))
    const specPath = gate.resolve(mission.id, ev.questions, answers)

    expect(db.queryEvents({ type: 'mission.clarification.answered' })).toHaveLength(1)
    expect(db.queryEvents({ type: 'mission.clarification.resolved' })).toHaveLength(1)
    expect(existsSync(specPath)).toBe(true)
    const spec = readFileSync(specPath, 'utf8')
    expect(spec).toContain('# Clarified Spec')
    expect(spec).toContain('Verifiable acceptance criteria')
    expect(gate.status(mission.id)).toBe('resolved')
  })

  it('status() is not_required for a mission with no clarification events', () => {
    const mission = db.insertMission({ repoId, title: 't', description: 'd', status: 'draft' })
    expect(new ClarificationGate(db, stateDir).status(mission.id)).toBe('not_required')
  })
})

describe('ClarificationGate recall/precision over labeled fixtures (ADR-0020 no-over-gate)', () => {
  const AMBIGUOUS: Array<{ title: string; description: string; ac: string[] }> = [
    { title: 'improve the dashboard', description: 'make the dashboard better and polish everything', ac: [] },
    { title: 'fix stuff', description: 'clean up the whole codebase and optimize various things', ac: ['TBD'] },
    { title: 'enhance it', description: 'enhance the app and make it nice', ac: [] },
  ]
  const CLEAR: Array<{ title: string; description: string; ac: string[] }> = [
    { title: 'Add README test docs', description: 'Add a "## Running the tests" section to README.md documenting `node tests/run.js`', ac: ['README.md has a "## Running the tests" heading documenting node tests/run.js'] },
    { title: 'Add add() unit test', description: 'Add `tests/add.test.js` asserting add(2,3) returns 5', ac: ['tests/add.test.js passes asserting add(2,3) === 5'] },
    { title: 'Fix null guard in parser', description: 'Guard against null input in `src/parser.ts` parse() and add a test', ac: ['src/parser.ts parse(null) returns [] and a test covers it'] },
  ]

  it('gates all ambiguous missions (recall = 1.0)', () => {
    const gate = new ClarificationGate(db, stateDir)
    for (const m of AMBIGUOUS) {
      const ev = gate.evaluate({ title: m.title, description: m.description }, design(m.ac))
      expect(ev.required, `expected to gate: ${m.title}`).toBe(true)
    }
  })

  it('passes all clear missions (false-gate rate = 0)', () => {
    const gate = new ClarificationGate(db, stateDir)
    for (const m of CLEAR) {
      const ev = gate.evaluate({ title: m.title, description: m.description }, design(m.ac))
      expect(ev.required, `expected NOT to gate: ${m.title}`).toBe(false)
    }
  })
})

describe('renderClarifiedSpec', () => {
  it('separates acceptance/done answers from scope/target', () => {
    const md = renderClarifiedSpec('m1',
      [
        { id: 'q1', field: 'acceptance-criteria', question: 'AC?', choices: [], recommendedDefault: '' },
        { id: 'q2', field: 'target', question: 'Target?', choices: [], recommendedDefault: '' },
      ],
      [
        { questionId: 'q1', field: 'acceptance-criteria', answer: 'test X passes' },
        { questionId: 'q2', field: 'target', answer: 'src/x.ts' },
      ],
    )
    expect(md).toContain('- test X passes')
    expect(md).toContain('target: src/x.ts')
  })
})
