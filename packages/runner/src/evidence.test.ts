import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { EvidenceWriter } from './evidence.js'

let dir: string, w: EvidenceWriter
beforeEach(() => {
  dir = join(tmpdir(), `evidence-test-${Date.now()}`)
  mkdirSync(dir, { recursive: true })
  w = new EvidenceWriter(dir)
})
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('EvidenceWriter', () => {
  it('writes and reads plan', () => {
    w.writePlan('# My Plan')
    expect(w.readFile('plan.md')).toBe('# My Plan')
  })

  it('toBundle returns all written files', () => {
    w.writePlan('plan'); w.writeDiffSummary('diff'); w.writeTestSummary('tests')
    const bundle = w.toBundle()
    expect(Object.keys(bundle)).toContain('plan.md')
    expect(Object.keys(bundle)).toContain('diff-summary.md')
    expect(Object.keys(bundle)).toContain('test-summary.md')
  })

  it('readFile returns null for missing file', () => {
    expect(w.readFile('nonexistent.md')).toBeNull()
  })
})
