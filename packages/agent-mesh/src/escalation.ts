import type { AgentMesh } from './instance.js'
import type { SubtaskRequest, SubtaskResult } from './protocol.js'

export interface RepairPolicy {
  /** Max repair attempts per failed subtask. Default 1. */
  maxRepairs?: number
  /** Agent type that runs the repair. Default 'repair'. */
  repairAgentType?: string
  /** Fallback agent type the repair re-spawns (typically 'coder'). */
  fallbackTo?: string
}

/**
 * Try fanOut; for every failed subtask, spawn a repair agent that
 * re-runs the (presumably-fixed) original subtask. Returns the
 * post-repair result set. Each repair attempt is itself recorded as
 * agent.subtask.{started,completed,failed} so the event log shows the
 * full repair chain.
 */
export async function fanOutWithRepair(
  mesh: AgentMesh,
  parentId: string,
  requests: Omit<SubtaskRequest, 'parentId'>[],
  policy: RepairPolicy = {},
): Promise<SubtaskResult[]> {
  const maxRepairs = policy.maxRepairs ?? 1
  const repairAgentType = policy.repairAgentType ?? 'repair'
  const fallbackTo = policy.fallbackTo ?? 'coder'

  const first = await mesh.fanOut(parentId, requests)
  const out: SubtaskResult[] = [...first]

  for (let attempt = 1; attempt <= maxRepairs; attempt++) {
    const stillFailed = out
      .map((r, i) => ({ r, i }))
      .filter(({ r }) => r.status === 'failed')
    if (stillFailed.length === 0) break

    // Spawn one repair agent that owns the retry batch.
    const repairId = await mesh.spawn(repairAgentType, {
      attempt, count: stillFailed.length, ids: stillFailed.map((s) => s.r.id),
    }, parentId)

    // Re-fan out the failing subtasks under the repair parent — same
    // ids so the saga semantics replay; the original idempotency keys
    // mean the event log dedups repeated splits, but the per-attempt
    // .completed / .failed are fresh events (no idempotency_source on
    // the runner-side; ULID makes them unique).
    const retries: Omit<SubtaskRequest, 'parentId'>[] = stillFailed.map(({ i }) => ({
      id: `${requests[i].id}#repair${attempt}`,
      agentType: fallbackTo,
      payload: { ...requests[i].payload, repairOf: requests[i].id, attempt },
    }))
    const retried = await mesh.fanOut(repairId, retries)
    for (let j = 0; j < stillFailed.length; j++) {
      // Map the retried result back into the parent's result slot.
      const slot = stillFailed[j].i
      out[slot] = { ...retried[j], id: requests[slot].id }
    }
    await mesh.exit(repairId, retried.every((r) => r.status === 'completed') ? 'repair_complete' : 'repair_partial')
  }

  return out
}
