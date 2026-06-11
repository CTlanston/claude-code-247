/** Overnight P5 — evidence audit package: run-summary.md renderer contract.
 *
 * Honesty rule under test: every required section exists in every render, a
 * missing input renders as an explicit "absent" marker, and the renderer can
 * NEVER fabricate a PASS or a "real" classification from missing evidence
 * (GR: evidence honesty — real / simulated / unproven explicit).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import {
  RUN_SUMMARY_SECTIONS,
  classifyRun,
  listEvidenceArtifacts,
  renderRunSummary,
  writeRunSummary,
  type RunSummaryInput,
} from './run-summary.js'

function fullInput(): RunSummaryInput {
  return {
    missionId: 'm-full',
    missionTitle: 'Ship the audit artifact',
    status: 'done',
    summary: 'Run run-1 exited 0; merge decision AUTO_MERGE.',
    changedPaths: ['README.md', 'src/foo.ts'],
    diffSummary: '# Diff Summary\n\nTwo files changed.\n',
    validatorResults: [
      { validator: 'gemini', verdict: 'pass', summary: 'evidence is consistent' },
      { validator: 'openai', verdict: 'pass' },
    ],
    reviewerVerdict: { verdict: 'approve', cycle: 2, findings: ['nit: rename helper'] },
    mergeDecision: 'AUTO_MERGE',
    prUrl: 'https://github.com/o/r/pull/7',
    costEvents: 3,
    headlessCalls: 1,
    holds: [{ code: 'HOLD-BUDGET', reason: 'daily cap reached' }],
    artifacts: ['diff-summary.md', 'plan.md'],
    provider: 'claude-cli',
    localCommitSha: 'abc123',
  }
}

describe('renderRunSummary — full input', () => {
  it('renders every required section with the supplied data', () => {
    const md = renderRunSummary(fullInput())
    for (const section of RUN_SUMMARY_SECTIONS) expect(md).toContain(section)
    expect(md).toContain('# Run Summary — m-full')
    expect(md).toContain('Ship the audit artifact')
    expect(md).toContain('- README.md')
    expect(md).toContain('- src/foo.ts')
    expect(md).toContain('- gemini: pass — evidence is consistent')
    expect(md).toContain('- openai: pass')
    expect(md).toContain('approve (cycle 2)')
    expect(md).toContain('nit: rename helper')
    expect(md).toContain('https://github.com/o/r/pull/7')
    expect(md).toContain('model usage events: 3')
    expect(md).toContain('headless calls (mission scope): 1')
    expect(md).toContain('- HOLD-BUDGET: daily cap reached')
    expect(md).toContain('- plan.md')
    expect(md).toContain('Classification: real')
    expect(md).toContain('abc123')
  })
})

describe('renderRunSummary — missing-file honesty', () => {
  it('renders every section as an explicit absent marker on a minimal input', () => {
    const md = renderRunSummary({ missionId: 'm-min', status: 'failed' })
    for (const section of RUN_SUMMARY_SECTIONS) expect(md).toContain(section)
    expect(md).toContain('(absent — no run summary recorded)')
    expect(md).toContain('(absent — runner produced no changed-paths.json)')
    expect(md).toContain('(absent — no diff evidence)')
    expect(md).toContain('(absent — no validator verdict recorded)')
    expect(md).toContain('(absent — no reviewer verdict recorded)')
    expect(md).toContain('(absent — no PR attempted and no gate outcome recorded)')
    expect(md).toContain('model usage events: absent')
    expect(md).toContain('headless calls (mission scope): absent')
    expect(md).toContain('(absent — hold state not collected)')
    expect(md).toContain('(absent — artifacts not listed)')
    // never a fabricated verdict
    expect(md).not.toContain(': pass')
    expect(md).not.toContain('PASS')
    expect(md).toContain('Classification: simulated')
  })

  it('an empty changed-paths list is reported as an empty diff, not as absent', () => {
    const md = renderRunSummary({ missionId: 'm-empty', status: 'waiting', changedPaths: [] })
    expect(md).toContain('(none — empty diff reported by the runner)')
    expect(md).not.toContain('(absent — runner produced no changed-paths.json)')
  })

  it('an empty validator list still renders as absent — never an implicit pass', () => {
    const md = renderRunSummary({ missionId: 'm-noval', status: 'waiting', validatorResults: [] })
    expect(md).toContain('(absent — no validator verdict recorded)')
  })
})

describe('classifyRun — real / simulated / unproven', () => {
  it('mock or missing provider → simulated', () => {
    expect(classifyRun({}).label).toBe('simulated')
    expect(classifyRun({ provider: 'mock', localCommitSha: 'abc', changedPaths: ['a'] }).label).toBe('simulated')
  })

  it('real provider + local commit + changed paths → real', () => {
    expect(classifyRun({ provider: 'claude-cli', localCommitSha: 'abc', changedPaths: ['a.ts'] }).label).toBe('real')
  })

  it('real provider without commit or diff evidence → unproven, never real', () => {
    expect(classifyRun({ provider: 'claude-cli' }).label).toBe('unproven')
    expect(classifyRun({ provider: 'codex-cli', localCommitSha: 'abc', changedPaths: [] }).label).toBe('unproven')
    expect(classifyRun({ provider: 'codex-cli', changedPaths: ['a.ts'] }).label).toBe('unproven')
  })
})

describe('writeRunSummary + listEvidenceArtifacts', () => {
  let dir: string
  beforeEach(() => {
    dir = join(tmpdir(), `aedev-run-summary-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
    mkdirSync(dir, { recursive: true })
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('writes run-summary.md into the evidence dir and returns its path', () => {
    const path = writeRunSummary(dir, { missionId: 'm-write', status: 'done' })
    expect(path).toBe(join(dir, 'run-summary.md'))
    expect(existsSync(path)).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain('# Run Summary — m-write')
  })

  it('lists top-level evidence files sorted, and returns [] for a missing dir', () => {
    writeFileSync(join(dir, 'b.md'), 'b')
    writeFileSync(join(dir, 'a.md'), 'a')
    mkdirSync(join(dir, 'nodes'))
    expect(listEvidenceArtifacts(dir)).toEqual(['a.md', 'b.md'])
    expect(listEvidenceArtifacts(join(dir, 'does-not-exist'))).toEqual([])
  })
})
