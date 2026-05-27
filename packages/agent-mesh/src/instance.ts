import type { EventLog, Reducer } from '@aedev/event-log'
import type { AgentTypeRegistry } from './registry.js'
import type { SubtaskRequest, SubtaskResult } from './protocol.js'
import { createHash } from 'node:crypto'

export type AgentStatus = 'spawned' | 'completed' | 'failed' | 'exited'

export interface AgentInstance {
  id: string
  agentType: string
  parentId: string | null
  status: AgentStatus
  spawnedAt: string
  budget: number
  /** Subtask ids this agent spawned. */
  subtaskIds: string[]
}

export type AgentRunFn = (req: SubtaskRequest) => Promise<SubtaskResult>

export interface MeshOpts {
  log: EventLog
  registry: AgentTypeRegistry
  taskId: string
  /** Map agentType → execution function. Production wires this to the worker pool. */
  runners: Map<string, AgentRunFn>
  actor?: string
  now?: () => Date
}

function aid(): string {
  return 'agt_' + createHash('sha256').update(String(Date.now()) + Math.random()).digest('hex').slice(0, 12)
}

export class AgentMesh {
  private readonly log: EventLog
  private readonly registry: AgentTypeRegistry
  private readonly taskId: string
  private readonly runners: Map<string, AgentRunFn>
  private readonly actor: string
  private readonly now: () => Date

  constructor(opts: MeshOpts) {
    this.log = opts.log
    this.registry = opts.registry
    this.taskId = opts.taskId
    this.runners = opts.runners
    this.actor = opts.actor ?? 'daemon.agent-mesh'
    this.now = opts.now ?? (() => new Date())
  }

  /** Spawn one agent of a given type with a payload. */
  async spawn(agentType: string, payload: Record<string, unknown>, parentId: string | null = null): Promise<string> {
    const spec = this.registry.get(agentType)
    if (!spec) throw new Error(`unknown agent type: ${agentType}`)
    const id = aid()
    await this.log.append({
      task_id: this.taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'agent.lifecycle.spawned',
      payload: { id, agentType, parentId, budget: spec.budgetTokens, payload },
      causation_id: parentId ?? undefined,
      idempotency_source: `${this.taskId}|agent.lifecycle.spawned|${id}`,
    })
    return id
  }

  /** Fan out N subtasks of the same agent type, collect all results. */
  async fanOut(parentId: string, requests: Omit<SubtaskRequest, 'parentId'>[]): Promise<SubtaskResult[]> {
    await this.log.append({
      task_id: this.taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'agent.subtask.split',
      payload: { parentId, count: requests.length, ids: requests.map((r) => r.id) },
      causation_id: parentId,
      idempotency_source: `${this.taskId}|agent.subtask.split|${parentId}|${requests.map((r) => r.id).sort().join(',')}`,
    })

    const results = await Promise.all(requests.map((r) => this.runOne({ ...r, parentId })))

    await this.log.append({
      task_id: this.taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'agent.fan_in.resolved',
      payload: {
        parentId, total: results.length,
        completed: results.filter((r) => r.status === 'completed').length,
        failed: results.filter((r) => r.status === 'failed').length,
      },
      causation_id: parentId,
      idempotency_source: `${this.taskId}|agent.fan_in.resolved|${parentId}`,
    })

    return results
  }

  private async runOne(req: SubtaskRequest): Promise<SubtaskResult> {
    const runner = this.runners.get(req.agentType)
    if (!runner) {
      return { id: req.id, status: 'failed', error: `no runner for agentType=${req.agentType}` }
    }
    try {
      const r = await runner(req)
      await this.log.append({
        task_id: this.taskId,
        ts: this.now().toISOString(),
        actor: this.actor,
        kind: r.status === 'completed' ? 'agent.subtask.completed' : 'agent.subtask.failed',
        payload: { id: req.id, agentType: req.agentType, parent: req.parentId, output: r.output, error: r.error },
        causation_id: req.parentId,
        idempotency_source: `${this.taskId}|agent.subtask.${r.status}|${req.id}`,
      })
      return r
    } catch (err) {
      const e = err instanceof Error ? err.message : String(err)
      await this.log.append({
        task_id: this.taskId,
        ts: this.now().toISOString(),
        actor: this.actor,
        kind: 'agent.subtask.failed',
        payload: { id: req.id, agentType: req.agentType, parent: req.parentId, error: e },
        causation_id: req.parentId,
        idempotency_source: `${this.taskId}|agent.subtask.failed|${req.id}`,
      })
      return { id: req.id, status: 'failed', error: e }
    }
  }

  async exit(parentId: string, reason: string): Promise<void> {
    await this.log.append({
      task_id: this.taskId,
      ts: this.now().toISOString(),
      actor: this.actor,
      kind: 'agent.lifecycle.exited',
      payload: { parentId, reason },
      causation_id: parentId,
      idempotency_source: `${this.taskId}|agent.lifecycle.exited|${parentId}`,
    })
  }
}

/** Reducer that rebuilds agent state from the event log. */
export const agentReducer: Reducer<Map<string, AgentInstance>> = (state, e) => {
  if (e.kind === 'agent.lifecycle.spawned') {
    const p = e.payload as { id: string; agentType: string; parentId: string | null; budget: number }
    const next = new Map(state)
    next.set(p.id, {
      id: p.id,
      agentType: p.agentType,
      parentId: p.parentId ?? null,
      status: 'spawned',
      spawnedAt: e.ts,
      budget: p.budget,
      subtaskIds: [],
    })
    return next
  }
  if (e.kind === 'agent.subtask.split') {
    const p = e.payload as { parentId: string; ids: string[] }
    const cur = state.get(p.parentId)
    if (!cur) return state
    const next = new Map(state)
    next.set(p.parentId, { ...cur, subtaskIds: [...cur.subtaskIds, ...p.ids] })
    return next
  }
  if (e.kind === 'agent.lifecycle.exited') {
    const p = e.payload as { parentId: string }
    const cur = state.get(p.parentId)
    if (!cur) return state
    const next = new Map(state)
    next.set(p.parentId, { ...cur, status: 'exited' })
    return next
  }
  return state
}
