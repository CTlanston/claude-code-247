import { describe, it, expect } from 'vitest'
import { MergePolicy } from './merge-policy.js'
import type { ValidatorResult } from '@aedev/core'

const mp = new MergePolicy()

const pass = (v: 'gemini' | 'openai' | 'mock' = 'mock'): ValidatorResult => ({
  id: '1', taskId: 't', runId: 'r', validator: v, verdict: 'pass', createdAt: '', summary: '',
})
const fail = (v: 'gemini' | 'openai' | 'mock' = 'mock'): ValidatorResult => ({
  id: '2', taskId: 't', runId: 'r', validator: v, verdict: 'fail', createdAt: '', summary: '',
})
const inconclusive = (v: 'gemini' | 'openai' | 'mock' = 'mock'): ValidatorResult => ({
  id: '3', taskId: 't', runId: 'r', validator: v, verdict: 'inconclusive', createdAt: '', summary: '',
})

describe('MergePolicy', () => {
  // --- BLOCKED cases ---

  it('high risk score (≥60) → BLOCKED regardless of validators', () => {
    expect(mp.decide(80, [pass('gemini'), pass('openai')])).toBe('BLOCKED')
    expect(mp.decide(60, [pass('gemini'), pass('openai')])).toBe('BLOCKED')
  })

  it('any fail → BLOCKED even at low risk', () => {
    expect(mp.decide(0, [fail()])).toBe('BLOCKED')
    expect(mp.decide(10, [pass('gemini'), fail('openai')])).toBe('BLOCKED')
  })

  it('pass + fail (disagreement) → BLOCKED (fail dominates)', () => {
    expect(mp.decide(0, [pass('gemini'), fail('openai')])).toBe('BLOCKED')
  })

  // --- WAITING cases ---

  it('no validators → WAITING (safety-first, never auto-merge)', () => {
    expect(mp.decide(0, [])).toBe('WAITING')
    expect(mp.decide(10, [])).toBe('WAITING')
    expect(mp.decide(29, [])).toBe('WAITING')
  })

  it('only one passing validator → WAITING (need dual validators)', () => {
    expect(mp.decide(0, [pass()])).toBe('WAITING')
    expect(mp.decide(10, [pass('gemini')])).toBe('WAITING')
  })

  it('inconclusive → WAITING', () => {
    expect(mp.decide(0, [inconclusive()])).toBe('WAITING')
    expect(mp.decide(0, [pass('gemini'), inconclusive('openai')])).toBe('WAITING')
  })

  it('medium risk (30–59) + dual pass → WAITING', () => {
    expect(mp.decide(30, [pass('gemini'), pass('openai')])).toBe('WAITING')
    expect(mp.decide(40, [pass('gemini'), pass('openai')])).toBe('WAITING')
    expect(mp.decide(59, [pass('gemini'), pass('openai')])).toBe('WAITING')
  })

  // --- AUTO_MERGE cases ---

  it('low risk + exactly 2 pass → AUTO_MERGE', () => {
    expect(mp.decide(0, [pass('gemini'), pass('openai')])).toBe('AUTO_MERGE')
    expect(mp.decide(10, [pass('gemini'), pass('openai')])).toBe('AUTO_MERGE')
    expect(mp.decide(29, [pass('gemini'), pass('openai')])).toBe('AUTO_MERGE')
  })

  it('low risk + 3 passes (all different validators) → AUTO_MERGE', () => {
    expect(mp.decide(5, [pass('gemini'), pass('openai'), pass('mock')])).toBe('AUTO_MERGE')
  })

  it('WAITING when Codex-authored work has only one validator family independent of the coder', () => {
    expect(mp.decide(10, [pass('gemini'), pass('openai')], {
      coderFamily: 'openai',
      requireIndependentValidatorFamilies: true,
    })).toBe('WAITING')
  })

  it('AUTO_MERGE when Claude-authored work has Gemini and OpenAI independent passes', () => {
    expect(mp.decide(10, [pass('gemini'), pass('openai')], {
      coderFamily: 'anthropic',
      requireIndependentValidatorFamilies: true,
    })).toBe('AUTO_MERGE')
  })
})
