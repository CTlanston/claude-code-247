/** Stage M3 — subtask spawn/return protocol. */

export interface SubtaskRequest {
  /** Unique id of the subtask (also used as event idempotency anchor). */
  id: string
  /** Agent type that should run this. */
  agentType: string
  /** Free-form payload for the subtask (prompt, args, etc). */
  payload: Record<string, unknown>
  /** Parent agent instance id (for fan-in / causation). */
  parentId: string
}

export interface SubtaskResult {
  id: string
  status: 'completed' | 'failed'
  output?: Record<string, unknown>
  error?: string
}
