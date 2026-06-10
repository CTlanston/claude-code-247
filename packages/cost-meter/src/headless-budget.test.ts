import { describe, it, expect } from 'vitest'
import {
  DEFAULT_HEADLESS_LIMITS,
  describeHeadlessBudgetBlock,
  evaluateHeadlessBudget,
  headlessLimitsFromEnv,
} from './headless-budget.js'

describe('evaluateHeadlessBudget (P1)', () => {
  it('allows calls under both caps', () => {
    const v = evaluateHeadlessBudget({ missionCalls: 0, dayCalls: 0 })
    expect(v.allowed).toBe(true)
    expect(v.reason).toBe('ok')
  })

  it('blocks at the mission cap boundary (>= is blocked, one-below is allowed)', () => {
    const limits = { maxPerMission: 15, maxPerDay: 60 }
    expect(evaluateHeadlessBudget({ missionCalls: 14, dayCalls: 14 }, limits).allowed).toBe(true)
    const v = evaluateHeadlessBudget({ missionCalls: 15, dayCalls: 15 }, limits)
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('mission_cap')
  })

  it('blocks at the day cap and prefers day_cap over mission_cap', () => {
    const limits = { maxPerMission: 15, maxPerDay: 60 }
    const v = evaluateHeadlessBudget({ missionCalls: 20, dayCalls: 60 }, limits)
    expect(v.allowed).toBe(false)
    expect(v.reason).toBe('day_cap')
  })

  it('a 0 limit disables calls entirely (no silent bypass)', () => {
    const v = evaluateHeadlessBudget({ missionCalls: 0, dayCalls: 0 }, { maxPerMission: 0, maxPerDay: 0 })
    expect(v.allowed).toBe(false)
  })

  it('describes both block reasons for the HOLD-BUDGET text', () => {
    const limits = { maxPerMission: 1, maxPerDay: 2 }
    const day = evaluateHeadlessBudget({ missionCalls: 0, dayCalls: 2 }, limits)
    expect(describeHeadlessBudgetBlock(day)).toMatch(/Daily headless-call budget/)
    const mission = evaluateHeadlessBudget({ missionCalls: 1, dayCalls: 1 }, limits)
    expect(describeHeadlessBudgetBlock(mission)).toMatch(/Mission headless-call budget/)
  })
})

describe('headlessLimitsFromEnv (P1)', () => {
  it('falls back to defaults when unset or invalid', () => {
    expect(headlessLimitsFromEnv({})).toEqual(DEFAULT_HEADLESS_LIMITS)
    expect(headlessLimitsFromEnv({
      AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION: 'not-a-number',
      AEDEV_BUDGET_MAX_HEADLESS_PER_DAY: '-5',
    })).toEqual(DEFAULT_HEADLESS_LIMITS)
  })

  it('reads explicit integer limits, flooring decimals', () => {
    expect(headlessLimitsFromEnv({
      AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION: '3',
      AEDEV_BUDGET_MAX_HEADLESS_PER_DAY: '9.7',
    })).toEqual({ maxPerMission: 3, maxPerDay: 9 })
  })
})
