import os from 'node:os'
import type { AgentRole } from '@aedev/core'

export type ProviderId = 'claude-docker' | 'claude-cli' | 'codex-cli' | 'gemini-api' | 'openai-api' | 'mock'
export type ModelFamily = 'anthropic' | 'openai' | 'google' | 'mock'

export interface WorkerSession {
  id: string
  provider: ProviderId
  family: ModelFamily
  healthy: boolean
  active: number
  probeStatus?: 'ok' | 'failed' | 'skipped'
  probeError?: string
  probedAt?: string
}

export interface RouteRequest {
  role: AgentRole
  reviewerFamily?: ModelFamily
  queueDepth?: number
  /** True when the downstream gate requires two validators independent of the coder family. */
  requiresIndependentValidators?: boolean
}

export interface RouteDecision {
  provider: ProviderId | null
  sessionId?: string
  concurrency: number
  holdCode?: 'HOLD-SESSION-POOL' | 'HOLD-FAMILY-CONFLICT'
  reason: string
}

const ROLE_PREFERENCES: Record<AgentRole, ProviderId[]> = {
  planner: ['claude-cli'],
  architect: ['claude-cli', 'codex-cli'],
  coder: ['codex-cli'],
  reviewer: ['gemini-api', 'openai-api', 'codex-cli'],
  validator: ['gemini-api', 'codex-cli', 'openai-api'],
  'doc-writer': ['codex-cli', 'claude-cli'],
  repair: ['claude-cli', 'codex-cli'],
}

export class WorkerPoolRouter {
  constructor(private readonly sessions: WorkerSession[]) {}

  decide(req: RouteRequest): RouteDecision {
    const concurrency = dynamicConcurrency(this.sessions, req.queueDepth ?? 0)
    const healthy = this.sessions.filter((s) => s.healthy)
    if (healthy.length === 0) {
      return { provider: null, concurrency, holdCode: 'HOLD-SESSION-POOL', reason: 'no healthy local or API sessions' }
    }

    const preferences = ROLE_PREFERENCES[req.role]
    for (const provider of preferences) {
      const session = healthy
        .filter((s) => s.provider === provider)
        .filter((s) => req.role !== 'validator' || !req.reviewerFamily || s.family !== req.reviewerFamily)
        .sort((a, b) => a.active - b.active)[0]
      if (session) {
        return {
          provider: session.provider,
          sessionId: session.id,
          concurrency,
          reason: `selected ${session.provider} for ${req.role}`,
        }
      }
    }

    if (req.role === 'validator' && req.reviewerFamily) {
      return {
        provider: null,
        concurrency,
        holdCode: 'HOLD-FAMILY-CONFLICT',
        reason: `no validator session differs from reviewer family ${req.reviewerFamily}`,
      }
    }
    return { provider: null, concurrency, holdCode: 'HOLD-SESSION-POOL', reason: `no session can run role ${req.role}` }
  }
}

export function dynamicConcurrency(sessions: readonly WorkerSession[], queueDepth: number): number {
  const healthy = sessions.filter((s) => s.healthy).length
  const cpuBudget = Math.max(1, Math.min(5, Math.floor(os.cpus().length / 2)))
  const pressure = queueDepth <= 1 ? 1 : queueDepth <= 3 ? 3 : 5
  return Math.max(1, Math.min(5, healthy, cpuBudget, pressure))
}
