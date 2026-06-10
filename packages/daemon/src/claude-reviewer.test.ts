import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import {
  ClaudeReviewer,
  DEFAULT_MAX_REVIEW_CYCLES,
  ReviewBlockedError,
  HOLD_REVIEW_STRUCTURE_CODE,
  maxReviewCyclesFromEnv,
  parseReviewVerdict,
  selectReviewEvidence,
} from './claude-reviewer.js'
import { HEADLESS_CALL_EVENT, HOLD_BUDGET_CODE } from './headless-budget-guard.js'

const ENV_KEYS = ['AEDEV_BUDGET_MAX_REVIEW_CYCLES', 'AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION', 'AEDEV_BUDGET_MAX_HEADLESS_PER_DAY'] as const
const saved: Record<string, string | undefined> = {}

beforeEach(() => { for (const k of ENV_KEYS) { saved[k] = process.env[k]; delete process.env[k] } })
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k]
    else process.env[k] = saved[k]
  }
})

describe('parseReviewVerdict (P2)', () => {
  it('parses a clean JSON verdict', () => {
    expect(parseReviewVerdict('{"verdict":"approve","findings":[],"confidence":92}'))
      .toEqual({ verdict: 'approve', findings: [], confidence: 92 })
  })

  it('tolerates surrounding prose and 0-1 confidence scale', () => {
    const v = parseReviewVerdict('Here is my review:\n{"verdict":"rework","findings":["missing test"],"confidence":0.8}\nthanks')
    expect(v).toEqual({ verdict: 'rework', findings: ['missing test'], confidence: 80 })
  })

  it('never invents a verdict: invalid JSON, bad verdict, or rework-without-findings → null', () => {
    expect(parseReviewVerdict('all good!')).toBeNull()
    expect(parseReviewVerdict('{"verdict":"ship-it","findings":[]}')).toBeNull()
    expect(parseReviewVerdict('{"verdict":"rework","findings":[],"confidence":50}')).toBeNull()
  })
})

describe('maxReviewCyclesFromEnv (P2)', () => {
  it('defaults to 2 and reads valid overrides', () => {
    expect(maxReviewCyclesFromEnv({})).toBe(DEFAULT_MAX_REVIEW_CYCLES)
    expect(maxReviewCyclesFromEnv({ AEDEV_BUDGET_MAX_REVIEW_CYCLES: '1' })).toBe(1)
    expect(maxReviewCyclesFromEnv({ AEDEV_BUDGET_MAX_REVIEW_CYCLES: 'nope' })).toBe(DEFAULT_MAX_REVIEW_CYCLES)
  })
})

describe('selectReviewEvidence (P2)', () => {
  it('selects PRD/diff/log files, skips unrelated, and truncates long content', () => {
    const picked = selectReviewEvidence({
      'prd.md': 'goals',
      'diff-summary.md': 'x'.repeat(20),
      'random.bin': 'noise',
      'gate-test.log': 'FAIL',
    }, 10)
    expect(picked.map((p) => p.name)).toEqual(['diff-summary.md', 'gate-test.log', 'prd.md'])
    expect(picked.find((p) => p.name === 'diff-summary.md')!.content).toMatch(/truncated/)
  })
})

describe('ClaudeReviewer (P2)', () => {
  function fakeAdapter(transcript: string, exitCode = 0) {
    return {
      async isAvailable() { return true },
      async run() {
        return { exitCode, transcript, authMode: 'local_claude_code', inputTokens: 5, outputTokens: 7, costUsd: null }
      },
    }
  }

  it('records the review call as a metered headless call and returns the verdict', async () => {
    const db = new AedevDb(':memory:')
    const reviewer = new ClaudeReviewer({ db, budgetKey: 'm1', adapter: fakeAdapter('{"verdict":"approve","findings":[],"confidence":88}') as never })
    const verdict = await reviewer.review({ missionId: 'm1', cycle: 1, bundle: { 'prd.md': 'x' } })
    expect(verdict.verdict).toBe('approve')
    const calls = db.queryEvents({ type: HEADLESS_CALL_EVENT, entityId: 'm1' })
    expect(calls).toHaveLength(1)
    expect(calls[0]!.payload).toMatchObject({ role: 'reviewer', provider: 'claude-cli' })
    db.close()
  })

  it('throws ReviewBlockedError with HOLD-BUDGET when the credit budget is exhausted (no spawn)', async () => {
    process.env['AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION'] = '0'
    const db = new AedevDb(':memory:')
    const reviewer = new ClaudeReviewer({ db, budgetKey: 'm1', adapter: fakeAdapter('unused') as never })
    await expect(reviewer.review({ missionId: 'm1', cycle: 1, bundle: {} }))
      .rejects.toMatchObject({ holdCode: HOLD_BUDGET_CODE })
    expect(db.queryEvents({ type: HEADLESS_CALL_EVENT })).toHaveLength(0)
    expect(db.listHolds('m1').some((h) => h.code === HOLD_BUDGET_CODE)).toBe(true)
    db.close()
  })

  it('throws HOLD-REVIEW-STRUCTURE on unparseable output instead of guessing (GR#7)', async () => {
    const db = new AedevDb(':memory:')
    const reviewer = new ClaudeReviewer({ db, budgetKey: 'm1', adapter: fakeAdapter('looks fine to me!') as never })
    await expect(reviewer.review({ missionId: 'm1', cycle: 1, bundle: {} }))
      .rejects.toSatisfy((e: unknown) => e instanceof ReviewBlockedError && e.holdCode === HOLD_REVIEW_STRUCTURE_CODE)
    // The failed-to-parse call still consumed credit and is recorded.
    expect(db.queryEvents({ type: HEADLESS_CALL_EVENT, entityId: 'm1' })).toHaveLength(1)
    db.close()
  })
})
