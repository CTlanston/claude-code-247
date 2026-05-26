import type { AedevDb, MemoryItem } from '@aedev/core'

/**
 * Product-team-specific wrappers over `AedevDb.insertMemoryItem` so callers
 * use a typed surface for the four memory categories the migration plan
 * carves out for Phase 10:
 *
 *   design-preference     — user's stated UI / visual / brand preferences
 *   stack-preference      — preferred frameworks, libraries, tooling
 *   architecture-convention — patterns the team consistently uses
 *   failure-pattern       — failure modes the system has already learned to avoid
 *
 * All memory items still go through the existing approval workflow (`approved`
 * field on MemoryItem) — recording a preference does not implicitly bless it
 * for future planning.  Phase 10 reads only approved items.
 */
export type ProductMemoryCategory =
  | 'design-preference'
  | 'stack-preference'
  | 'architecture-convention'
  | 'failure-pattern'

export interface RecordOptions {
  repoId?: string
  sourceTaskId?: string
  sourceMissionId?: string
  approved?: boolean  // default false — Phase 10's user approval flow flips this
}

export class ProductMemory {
  constructor(private readonly db: AedevDb) {}

  record(category: ProductMemoryCategory, title: string, content: string, opts: RecordOptions = {}): MemoryItem {
    return this.db.insertMemoryItem({
      type: category,
      title,
      content,
      approved: opts.approved ?? false,
      ...(opts.repoId !== undefined ? { repoId: opts.repoId } : {}),
      ...(opts.sourceTaskId !== undefined ? { sourceTaskId: opts.sourceTaskId } : {}),
      ...(opts.sourceMissionId !== undefined ? { sourceMissionId: opts.sourceMissionId } : {}),
    })
  }

  /** Returns only APPROVED memory items in the given category. */
  recall(category: ProductMemoryCategory, opts: { repoId?: string } = {}): MemoryItem[] {
    const filters: { approved: boolean; repoId?: string } = { approved: true }
    if (opts.repoId !== undefined) filters.repoId = opts.repoId
    return this.db
      .listMemoryItems(filters)
      .filter((m) => m.type === category)
  }

  /** Returns ALL memory items (approved and pending) for the category. */
  list(category: ProductMemoryCategory, opts: { repoId?: string } = {}): MemoryItem[] {
    const filters: { repoId?: string } = {}
    if (opts.repoId !== undefined) filters.repoId = opts.repoId
    return this.db.listMemoryItems(filters).filter((m) => m.type === category)
  }

  approve(id: string): void {
    this.db.approveMemoryItem(id)
  }

  /** Convenience: record a failure pattern observed during a task's failure. */
  recordFailurePattern(args: { signature: string; description: string; repoId?: string; taskId?: string }): MemoryItem {
    return this.record('failure-pattern', `Failure ${args.signature.slice(0, 8)}`, args.description, {
      ...(args.repoId !== undefined ? { repoId: args.repoId } : {}),
      ...(args.taskId !== undefined ? { sourceTaskId: args.taskId } : {}),
    })
  }
}
