/** Stage M3 — AgentTypeRegistry. */

export interface AgentTypeSpec {
  name: string
  description: string
  /** Token budget per invocation. */
  budgetTokens: number
  /** What subtasks this agent CAN spawn. Open subset → can spawn anything. */
  canSpawn: 'open' | readonly string[]
}

export class AgentTypeRegistry {
  private readonly types = new Map<string, AgentTypeSpec>()
  register(spec: AgentTypeSpec): void {
    if (this.types.has(spec.name)) throw new Error(`agent type already registered: ${spec.name}`)
    this.types.set(spec.name, spec)
  }
  get(name: string): AgentTypeSpec | undefined {
    return this.types.get(name)
  }
  list(): AgentTypeSpec[] {
    return [...this.types.values()]
  }
}

/** Workbook §3 Stage M3 wants 5 built-in types migrated from runner/roles/. */
export const BUILTIN_AGENT_TYPES: AgentTypeSpec[] = [
  { name: 'planner', description: 'Decomposes missions into subtasks', budgetTokens: 20_000, canSpawn: 'open' },
  { name: 'coder',   description: 'Writes code for a single subtask',   budgetTokens: 30_000, canSpawn: [] },
  { name: 'reviewer',description: 'Reviews a coder\'s diff',             budgetTokens: 10_000, canSpawn: [] },
  { name: 'repair',  description: 'Patches a failed coder subtask',     budgetTokens: 25_000, canSpawn: ['coder'] },
  { name: 'curator', description: 'Updates memory / writes ADRs',       budgetTokens:  8_000, canSpawn: [] },
]

export function defaultRegistry(): AgentTypeRegistry {
  const r = new AgentTypeRegistry()
  for (const t of BUILTIN_AGENT_TYPES) r.register(t)
  return r
}
