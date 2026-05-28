import { describe, expect, it } from 'vitest'
import type { MissionDesign } from '@aedev/core'
import { planDocFollowup } from './doc-followup.js'

const design: MissionDesign = {
  missionId: 'm1',
  title: 'Mission OS worker pool',
  prd: {
    summary: 'Update daemon scheduler and worker pool.',
    goals: ['Ship draft PR flow'],
    nonGoals: [],
    acceptanceCriteria: ['Draft PR created'],
    risks: [],
    rollbackPlan: 'Disable scheduler.',
    documentationImpact: 'Operations docs and ADR.',
  },
  adrDraft: {
    title: 'ADR',
    context: 'Context.',
    decision: 'Use local worker pool.',
    consequences: 'Local quota bound.',
  },
  roadmap: ['Do it'],
  checkpoints: [],
  taskDag: [{ id: 't1', title: 'Code', role: 'coder', parentIds: [], contextFiles: [], writeFiles: [], expectedEvidence: [], checkpointGate: null }],
}

describe('planDocFollowup', () => {
  it('creates a docs task and memory proposal after validated draft PR', () => {
    const out = planDocFollowup({
      missionId: 'm1',
      draftPrUrl: 'https://example/pr/1',
      design,
      changedFiles: ['packages/daemon/src/foo.ts'],
      validatorPassed: true,
    })

    expect(out.taskTitle).toBe('Document mission m1')
    expect(out.docsToUpdate).toContain('CHANGELOG.md')
    expect(out.docsToUpdate).toContain('docs/OPERATIONS.md')
    expect(out.docsToUpdate).toContain('docs/adr/')
    expect(out.memoryProposal).toContain('draft PR')
  })

  it('does not write memory when validation failed', () => {
    const out = planDocFollowup({
      missionId: 'm1',
      draftPrUrl: 'https://example/pr/1',
      design,
      changedFiles: [],
      validatorPassed: false,
    })

    expect(out.memoryProposal).toBeNull()
  })
})
