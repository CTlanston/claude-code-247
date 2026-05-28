import { describe, expect, it } from 'vitest'
import { requiresCheckpoint, validateMissionDesign } from './mission-design.js'

describe('MissionDesignSchema', () => {
  it('accepts a PRD/ADR/task-DAG design', () => {
    const design = validateMissionDesign({
      missionId: 'm_1',
      title: 'Mission OS',
      brainstormSummary: {
        intent: 'Create autonomous draft PRs.',
        constraints: ['No auto-merge in v2.3'],
      },
      prd: {
        summary: 'Build a local 7x24 coding coworker.',
        goals: ['Create draft PRs from approved missions'],
        acceptanceCriteria: ['A draft PR body includes evidence links'],
        rollbackPlan: 'Disable the scheduler and leave branches unmerged.',
        documentationImpact: 'Update operations docs.',
      },
      adrDraft: {
        title: 'Use local subscription workers',
        context: 'The Mac owns execution.',
        decision: 'Route work to Claude and Codex CLIs.',
        alternatives: ['Use API-only agents'],
        consequences: 'Throughput is bounded by local session health.',
      },
      roadmap: ['Stage 1 worker pool', 'Stage 2 mission designer'],
      taskDag: [
        {
          id: 't1',
          title: 'Implement Codex adapter',
          role: 'coder',
          writeFiles: ['packages/runner/src/codex-adapter.ts'],
          expectedEvidence: ['test.out'],
        },
      ],
    })

    expect(design.taskDag[0]?.parentIds).toEqual([])
    expect(design.checkpoints).toEqual([])
  })

  it('rejects designs without verifiable acceptance criteria', () => {
    expect(() => validateMissionDesign({
      missionId: 'm_1',
      title: 'Bad mission',
      brainstormSummary: { intent: 'Ship something.' },
      prd: {
        summary: 'No AC.',
        goals: ['Ship something'],
        acceptanceCriteria: [],
        rollbackPlan: 'Revert.',
        documentationImpact: 'None.',
      },
      adrDraft: {
        title: 'ADR',
        context: 'Context.',
        decision: 'Decision.',
        consequences: 'Consequences.',
      },
      roadmap: ['Do it'],
      taskDag: [{ id: 't1', title: 'Task', role: 'coder' }],
    })).toThrow()
  })

  it('rejects coder tasks without declared write files', () => {
    expect(() => validateMissionDesign({
      missionId: 'm_1',
      title: 'Bad coder task',
      brainstormSummary: { intent: 'Implement a change.' },
      prd: {
        summary: 'Has AC.',
        goals: ['Ship a bounded change'],
        acceptanceCriteria: ['Tests pass'],
        rollbackPlan: 'Revert.',
        documentationImpact: 'None.',
      },
      adrDraft: {
        title: 'ADR',
        context: 'Context.',
        decision: 'Decision.',
        consequences: 'Consequences.',
      },
      roadmap: ['Do it'],
      taskDag: [{ id: 't1', title: 'Task', role: 'coder', expectedEvidence: ['done-report.md'] }],
    })).toThrow(/writeFiles/)
  })
})

describe('requiresCheckpoint', () => {
  it('flags architecture, dependency, security, workflow, and large-refactor work', () => {
    expect(requiresCheckpoint('Add an ADR for the scheduler')).toBe(true)
    expect(requiresCheckpoint('Update UI', ['package.json'])).toBe(true)
    expect(requiresCheckpoint('Refactor auth token handling')).toBe(true)
    expect(requiresCheckpoint('Change CI', ['.github/workflows/ci.yml'])).toBe(true)
    expect(requiresCheckpoint('Large refactor of daemon')).toBe(true)
  })

  it('lets ordinary low-risk coding work proceed without a checkpoint', () => {
    expect(requiresCheckpoint('Fix button copy', ['apps/dashboard/src/App.tsx'])).toBe(false)
  })
})
