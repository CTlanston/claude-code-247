import type { Mission } from '@aedev/core'

/**
 * Role pipeline contracts for the autonomous product team (Phase 5).
 *
 * Per ADR-0009 §product-workflow, every mission flows through a sequence of
 * roles — PM (handled by IntakeService), Architect, Designer, Builder, QA,
 * Reviewer, Release.  Each role takes the accumulated evidence bundle and
 * emits new evidence files.  The pipeline is the only place that knows the
 * canonical role order.
 *
 * MVP scope: roles are template-based (deterministic markdown emitters).  A
 * later phase upgrades them to invoke `ClaudeCodeAdapter` for LLM-driven
 * content generation, gated by the same auth/safety rules.
 */
export interface RoleContext {
  mission: Mission
  /** Filesystem dir where evidence files live for this mission. */
  evidenceDir: string
  /** All evidence files accumulated so far in this mission (filename → contents). */
  bundle: Record<string, string>
  /** Optional flag — if true, design/QA roles must produce UI artefacts (screenshot report etc.). */
  requiresUi?: boolean
  /** Optional risk level inherited from the mission. */
  riskLevel?: 'low' | 'medium' | 'high'
}

/**
 * Specification for a child task the Builder role wants the runner to execute.
 * Phase 5 records these as evidence; later phases (auto-merge / release) will
 * persist them as Task rows and respect the `dependsOn` ordering.
 */
export interface BuilderTaskSpec {
  /** Stable handle this builder spec uses to be referenced by other specs. */
  ref: string
  title: string
  prompt: string
  /** Other spec `ref`s that must complete before this one starts. */
  dependsOn?: string[]
  /** Path prefix this task owns — used by later phases for conflict avoidance. */
  fileOwnership?: string[]
}

export interface RoleOutput {
  /** filename → contents.  Written into `ctx.evidenceDir` and merged into `ctx.bundle`. */
  evidenceFiles: Record<string, string>
  /** Free-form notes the pipeline records in its run log. */
  notes?: string
  /** For Builder only: the task graph this builder is requesting. */
  childTasks?: BuilderTaskSpec[]
}

export interface Role {
  readonly name: 'pm' | 'architect' | 'designer' | 'builder' | 'qa' | 'reviewer' | 'release'
  execute(ctx: RoleContext): Promise<RoleOutput>
}
