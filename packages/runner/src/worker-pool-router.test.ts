import { describe, expect, it } from 'vitest'
import { dynamicConcurrency, WorkerPoolRouter, type WorkerSession } from './worker-pool-router.js'

const sessions: WorkerSession[] = [
  { id: 'claude-1', provider: 'claude-cli', family: 'anthropic', healthy: true, active: 1 },
  { id: 'codex-1', provider: 'codex-cli', family: 'openai', healthy: true, active: 0 },
  { id: 'gemini-1', provider: 'gemini-api', family: 'google', healthy: true, active: 0 },
]

describe('WorkerPoolRouter', () => {
  it('routes coder work to Codex before Claude by default', () => {
    const decision = new WorkerPoolRouter(sessions).decide({ role: 'coder', queueDepth: 5 })
    expect(decision.provider).toBe('codex-cli')
    expect(decision.sessionId).toBe('codex-1')
  })

  it('routes dual-validator hard-gate coder work to Claude', () => {
    const decision = new WorkerPoolRouter(sessions).decide({
      role: 'coder',
      queueDepth: 5,
      requiresIndependentValidators: true,
    })
    expect(decision.provider).toBe('claude-cli')
    expect(decision.sessionId).toBe('claude-1')
  })

  it('holds dual-validator hard-gate coder work when Claude is unavailable', () => {
    const decision = new WorkerPoolRouter([
      { id: 'codex-1', provider: 'codex-cli', family: 'openai', healthy: true, active: 0 },
      { id: 'gemini-1', provider: 'gemini-api', family: 'google', healthy: true, active: 0 },
    ]).decide({ role: 'coder', requiresIndependentValidators: true })

    expect(decision.provider).toBeNull()
    expect(decision.holdCode).toBe('HOLD-SESSION-POOL')
  })

  it('routes planner work to Claude before Codex', () => {
    const decision = new WorkerPoolRouter(sessions).decide({ role: 'planner', queueDepth: 5 })
    expect(decision.provider).toBe('claude-cli')
  })

  it('enforces validator family separation from reviewer', () => {
    const decision = new WorkerPoolRouter([
      { id: 'gemini-1', provider: 'gemini-api', family: 'google', healthy: true, active: 0 },
    ]).decide({ role: 'validator', reviewerFamily: 'google', queueDepth: 2 })

    expect(decision.provider).toBeNull()
    expect(decision.holdCode).toBe('HOLD-FAMILY-CONFLICT')
  })

  it('holds when every session is unhealthy', () => {
    const decision = new WorkerPoolRouter([
      { id: 'codex-1', provider: 'codex-cli', family: 'openai', healthy: false, active: 0 },
    ]).decide({ role: 'coder', queueDepth: 5 })

    expect(decision.provider).toBeNull()
    expect(decision.holdCode).toBe('HOLD-SESSION-POOL')
  })
})

describe('dynamicConcurrency', () => {
  it('keeps concurrency between 1 and 5', () => {
    expect(dynamicConcurrency(sessions, 0)).toBeGreaterThanOrEqual(1)
    expect(dynamicConcurrency(sessions, 20)).toBeLessThanOrEqual(5)
  })
})
