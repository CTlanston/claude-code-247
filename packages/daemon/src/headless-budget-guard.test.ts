import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import {
  HEADLESS_CALL_EVENT,
  HOLD_BUDGET_CODE,
  checkHeadlessBudget,
  countHeadlessCallsForSession,
  countHeadlessCallsToday,
  createBudgetHold,
  recordHeadlessCall,
} from './headless-budget-guard.js'

const ENV_KEYS = ['AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION', 'AEDEV_BUDGET_MAX_HEADLESS_PER_DAY', 'AEDEV_NTFY_TOPIC'] as const
const saved: Record<string, string | undefined> = {}

let db: AedevDb

beforeEach(() => {
  db = new AedevDb(':memory:')
  for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] }
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('headless budget guard (P1)', () => {
  it('records every call as a cost.headless_call event with role/provider/tokens', () => {
    recordHeadlessCall(db, 's1', { role: 'planner', provider: 'claude-cli', authMode: 'local_claude_code', inputTokens: 10, outputTokens: 20, exitCode: 0 })
    const events = db.queryEvents({ type: HEADLESS_CALL_EVENT })
    expect(events).toHaveLength(1)
    expect(events[0]!.payload).toMatchObject({ role: 'planner', provider: 'claude-cli', authMode: 'local_claude_code', inputTokens: 10, outputTokens: 20 })
    expect(events[0]!.entityId).toBe('s1')
  })

  it('rebuilds mission and daily counts purely from events (GR#5)', () => {
    recordHeadlessCall(db, 's1', { role: 'planner', provider: 'claude-cli' })
    recordHeadlessCall(db, 's1', { role: 'planner-followup', provider: 'claude-cli' })
    recordHeadlessCall(db, 's2', { role: 'planner', provider: 'claude-cli' })
    expect(countHeadlessCallsForSession(db, 's1')).toBe(2)
    expect(countHeadlessCallsForSession(db, 's2')).toBe(1)
    expect(countHeadlessCallsToday(db)).toBe(3)
    // Another UTC day sees zero — the daily window derives from event timestamps.
    expect(countHeadlessCallsToday(db, new Date('1999-01-01T00:00:00Z'))).toBe(0)
  })

  it('allows under budget and blocks at the mission cap', () => {
    process.env['AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION'] = '2'
    process.env['AEDEV_BUDGET_MAX_HEADLESS_PER_DAY'] = '50'
    recordHeadlessCall(db, 's1', { role: 'planner', provider: 'claude-cli' })
    expect(checkHeadlessBudget(db, 's1').allowed).toBe(true)
    recordHeadlessCall(db, 's1', { role: 'planner-followup', provider: 'claude-cli' })
    const v = checkHeadlessBudget(db, 's1')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('mission_cap')
  })

  it('blocks at the day cap across sessions', () => {
    process.env['AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION'] = '10'
    process.env['AEDEV_BUDGET_MAX_HEADLESS_PER_DAY'] = '2'
    recordHeadlessCall(db, 's1', { role: 'planner', provider: 'claude-cli' })
    recordHeadlessCall(db, 's2', { role: 'planner', provider: 'claude-cli' })
    const v = checkHeadlessBudget(db, 's3')
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('day_cap')
  })

  it('creates one active HOLD-BUDGET per session, emits the hold event and the notify event', () => {
    process.env['AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION'] = '0'
    const verdict = checkHeadlessBudget(db, 's1')
    expect(verdict.allowed).toBe(false)
    createBudgetHold(db, 's1', verdict)
    createBudgetHold(db, 's1', verdict) // second block: event again, but no duplicate hold
    const holds = db.listHolds('s1').filter((h) => h.code === HOLD_BUDGET_CODE && h.status === 'active')
    expect(holds).toHaveLength(1)
    expect(holds[0]!.reason).toMatch(/Agent SDK monthly credit/)
    expect(db.queryEvents({ type: 'operator.hold_created', entityId: 's1' })).toHaveLength(2)
    expect(db.queryEvents({ type: 'operator.notify_requested', entityId: 's1' })).toHaveLength(1)
  })
})
