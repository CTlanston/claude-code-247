import { mkdtempSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { LeadAgent } from './lead-agent.js'

describe('LeadAgent', () => {
  it('turns a big idea into PRD, ADR draft, roadmap, checkpoints, and task DAG', () => {
    const agent = new LeadAgent(mkdtempSync(join(tmpdir(), 'aedev-lead-')))
    const design = agent.designMission(
      'm_123',
      'Build a local 7x24 Mission OS with Codex and Claude workers, validation, docs, and draft PRs.',
      'Mission OS',
    )

    expect(design.prd.acceptanceCriteria.length).toBeGreaterThanOrEqual(3)
    expect(design.adrDraft.decision).toContain('v2.3')
    expect(design.roadmap.length).toBeGreaterThanOrEqual(3)
    expect(design.taskDag.length).toBeGreaterThanOrEqual(3)
    expect(design.taskDag.map((t) => t.role)).toContain('coder')
    expect(design.taskDag.map((t) => t.role)).toContain('validator')
  })

  it('creates a checkpoint when the idea is architecture or dependency sensitive', () => {
    const agent = new LeadAgent(mkdtempSync(join(tmpdir(), 'aedev-lead-')))
    const design = agent.designMission('m_123', 'Change architecture and add a dependency.')

    expect(design.checkpoints.length).toBeGreaterThan(0)
    expect(design.taskDag.some((t) => t.checkpointGate)).toBe(true)
  })
})
