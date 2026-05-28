import { z } from 'zod'

export const AgentRoleSchema = z.enum([
  'planner',
  'architect',
  'coder',
  'reviewer',
  'validator',
  'doc-writer',
  'repair',
])

export const CheckpointSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  reason: z.string().min(1),
  required: z.boolean(),
})

export const MissionDagTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  role: AgentRoleSchema,
  parentIds: z.array(z.string()).default([]),
  contextFiles: z.array(z.string()).default([]),
  writeFiles: z.array(z.string()).default([]),
  expectedEvidence: z.array(z.string()).default([]),
  checkpointGate: z.string().nullable().default(null),
})

export const BrainstormSummarySchema = z.object({
  intent: z.string().min(1),
  constraints: z.array(z.string()).default([]),
  tradeoffs: z.array(z.string()).default([]),
  openQuestions: z.array(z.string()).default([]),
})

export const MissionDesignSchema = z.object({
  missionId: z.string().min(1),
  title: z.string().min(1),
  brainstormSummary: BrainstormSummarySchema,
  prd: z.object({
    summary: z.string().min(1),
    goals: z.array(z.string()).min(1),
    nonGoals: z.array(z.string()).default([]),
    acceptanceCriteria: z.array(z.string()).min(1),
    risks: z.array(z.string()).default([]),
    rollbackPlan: z.string().min(1),
    documentationImpact: z.string().min(1),
  }),
  adrDraft: z.object({
    title: z.string().min(1),
    context: z.string().min(1),
      decision: z.string().min(1),
      alternatives: z.array(z.string()).default([]),
      consequences: z.string().min(1),
    }),
  roadmap: z.array(z.string()).min(1),
  checkpoints: z.array(CheckpointSchema).default([]),
  taskDag: z.array(MissionDagTaskSchema).min(1),
}).superRefine((design, ctx) => {
  for (const [index, task] of design.taskDag.entries()) {
    if (task.role === 'coder' && task.writeFiles.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskDag', index, 'writeFiles'],
        message: 'coder tasks must declare writeFiles',
      })
    }
    if (task.expectedEvidence.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['taskDag', index, 'expectedEvidence'],
        message: 'every task must declare expectedEvidence',
      })
    }
  }
})

export type AgentRole = z.infer<typeof AgentRoleSchema>
export type Checkpoint = z.infer<typeof CheckpointSchema>
export type BrainstormSummary = z.infer<typeof BrainstormSummarySchema>
export type MissionDagTask = z.infer<typeof MissionDagTaskSchema>
export type MissionDesign = z.infer<typeof MissionDesignSchema>

const CHECKPOINT_PATTERNS = [
  /architecture|ADR|schema|migration/i,
  /dependency|package\.json|pnpm-lock/i,
  /security|auth|secret|token|credential/i,
  /\.github|workflow|CI/i,
  /large refactor|rewrite|delete|remove/i,
]

export function requiresCheckpoint(text: string, writeFiles: readonly string[] = []): boolean {
  const haystack = [text, ...writeFiles].join('\n')
  return CHECKPOINT_PATTERNS.some((re) => re.test(haystack))
}

export function validateMissionDesign(input: unknown): MissionDesign {
  return MissionDesignSchema.parse(input)
}
