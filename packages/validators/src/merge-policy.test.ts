import { describe, it, expect } from 'vitest'
import { MergePolicy } from './merge-policy.js'
import type { ValidatorResult } from '@aedev/core'

const makeResult = (verdict: 'pass' | 'fail' | 'inconclusive', validator: 'gemini' | 'openai' | 'mock' = 'mock'): ValidatorResult => ({
  id: '1', taskId: 't', runId: 'r', validator, verdict, createdAt: '', summary: '',
})

describe('MergePolicy', () => {
  const mp = new MergePolicy()

  it('score >= 60 → BLOCKED regardless of validators', () => {
    expect(mp.decide(80, [makeResult('pass'), makeResult('pass')])).toBe('BLOCKED')
  })

  it('score 30-59 + both pass → WAITING', () => {
    expect(mp.decide(40, [makeResult('pass'), makeResult('pass')])).toBe('WAITING')
  })

  it('score < 30 + both pass → AUTO_MERGE', () => {
    expect(mp.decide(0, [makeResult('pass'), makeResult('pass')])).toBe('AUTO_MERGE')
  })

  it('validator disagreement → WAITING', () => {
    expect(mp.decide(0, [makeResult('pass', 'gemini'), makeResult('fail', 'openai')])).toBe('WAITING')
  })

  it('no validators + low score → AUTO_MERGE', () => {
    expect(mp.decide(10, [])).toBe('AUTO_MERGE')
  })
})
