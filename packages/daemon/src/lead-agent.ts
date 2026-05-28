import type { MissionDagTask, MissionDesign } from '@aedev/core'
import { requiresCheckpoint, validateMissionDesign } from '@aedev/core'

export class LeadAgent {
  constructor(private stateDir: string) {
    // stateDir reserved for future use (ADR/roadmap writing)
    void this.stateDir
  }

  generatePrdTemplate(missionId: string, description: string): string {
    return `# PRD: ${description}

**Mission ID:** ${missionId}
**Status:** Draft — awaiting human review and approval
**Created:** ${new Date().toISOString()}

---

## Summary
<!-- Describe what this mission delivers in 1-2 sentences -->
${description}

## Problem Statement
<!-- What problem are we solving? -->

## Goals
<!-- What must be true when this mission is done? -->
- [ ]

## Non-Goals
<!-- What is explicitly out of scope? -->
-

## Success Criteria
<!-- Measurable / observable outcomes -->
- [ ]

## Acceptance Criteria
<!-- Verifiable checks that a Validator can evaluate from evidence only -->
- [ ]

## Risks and Mitigation
<!-- What could go wrong? -->

## Notes
<!-- Additional context for the Builder agent -->
`
  }

  designMission(missionId: string, description: string, title?: string): MissionDesign {
    const missionTitle = title ?? description.split('\n')[0]?.slice(0, 80) ?? 'Untitled mission'
    const tasks = buildDefaultDag(description)
    const checkpoints = tasks
      .filter((task) => requiresCheckpoint(`${task.title}\n${description}`, task.writeFiles))
      .map((task) => ({
        id: `cp-${task.id}`,
        title: `Review ${task.title}`,
        reason: 'Architecture, dependency, security, workflow, or large-refactor risk requires operator approval.',
        required: true,
      }))
    const gatedTasks = tasks.map((task) => {
      const cp = checkpoints.find((checkpoint) => checkpoint.id === `cp-${task.id}`)
      return { ...task, checkpointGate: cp?.id ?? null }
    })

    return validateMissionDesign({
      missionId,
      title: missionTitle,
      prd: {
        summary: description,
        goals: [
          'Produce a reviewed implementation plan and evidence-backed draft PR.',
          'Keep execution local-first and resumable through bounded moves.',
        ],
        nonGoals: ['Automatic merge is out of scope for v2.3.'],
        acceptanceCriteria: [
          'Task DAG is valid and every runnable task declares expected evidence.',
          'Reviewer and validator consume evidence-only context.',
          'Final output is a draft PR or a local HOLD with evidence.',
        ],
        risks: [
          'Local subscription CLI sessions may expire or hit quota.',
          'Mixed intake can create noisy candidates without classifier gates.',
        ],
        rollbackPlan: 'Disable mission scheduling; leave any created branch as an unmerged draft PR.',
        documentationImpact: 'Update ADR, operations notes, and per-repo memory when implementation changes behavior.',
      },
      adrDraft: {
        title: `ADR: ${missionTitle}`,
        context: description,
        decision: 'Implement this mission through the v2.3 local Mission OS pipeline.',
        consequences: 'The daemon may open a draft PR after validation, but must not merge it automatically.',
      },
      roadmap: [
        'Clarify mission intent and acceptance criteria.',
        'Run bounded coder moves through the local worker pool.',
        'Review and validate from redacted evidence.',
        'Prepare documentation updates and draft PR.',
      ],
      checkpoints,
      taskDag: gatedTasks,
    })
  }

  renderDesignMarkdown(design: MissionDesign): string {
    return [
      `# Mission Design: ${design.title}`,
      '',
      `**Mission ID:** ${design.missionId}`,
      '',
      '## PRD',
      design.prd.summary,
      '',
      '### Goals',
      ...design.prd.goals.map((g) => `- ${g}`),
      '',
      '### Acceptance Criteria',
      ...design.prd.acceptanceCriteria.map((a) => `- ${a}`),
      '',
      '### Rollback',
      design.prd.rollbackPlan,
      '',
      '## ADR Draft',
      `**Decision:** ${design.adrDraft.decision}`,
      '',
      '## Roadmap',
      ...design.roadmap.map((r, i) => `${i + 1}. ${r}`),
      '',
      '## Checkpoints',
      ...(design.checkpoints.length
        ? design.checkpoints.map((c) => `- ${c.id}: ${c.title} (${c.reason})`)
        : ['- None']),
      '',
      '## Task DAG',
      ...design.taskDag.map((task) => `- ${task.id} [${task.role}]: ${task.title}`),
      '',
    ].join('\n')
  }
}

function buildDefaultDag(description: string): MissionDagTask[] {
  const sensitive = requiresCheckpoint(description)
  return [
    {
      id: 'design',
      title: 'Finalize PRD, ADR draft, and task DAG',
      role: 'planner',
      parentIds: [],
      contextFiles: ['README.md', 'docs/adr/'],
      writeFiles: ['docs/adr/'],
      expectedEvidence: ['mission-design.json', 'mission-design.md'],
      checkpointGate: sensitive ? 'cp-design' : null,
    },
    {
      id: 'implement',
      title: 'Implement bounded local changes',
      role: 'coder',
      parentIds: ['design'],
      contextFiles: [],
      writeFiles: [],
      expectedEvidence: ['git.diff', 'test-summary.md', 'done-report.md'],
      checkpointGate: null,
    },
    {
      id: 'validate',
      title: 'Review and validate evidence-only output',
      role: 'validator',
      parentIds: ['implement'],
      contextFiles: [],
      writeFiles: [],
      expectedEvidence: ['validator-result.json', 'risk-report.md'],
      checkpointGate: null,
    },
    {
      id: 'document',
      title: 'Update docs and memory proposal',
      role: 'doc-writer',
      parentIds: ['validate'],
      contextFiles: ['README.md', 'docs/OPERATIONS.md', 'CHANGELOG.md'],
      writeFiles: ['README.md', 'docs/OPERATIONS.md', 'CHANGELOG.md'],
      expectedEvidence: ['docs-summary.md'],
      checkpointGate: null,
    },
  ]
}
