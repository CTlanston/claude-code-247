import { describe, it, expect } from 'vitest'
import { diffStreams, withinThreshold, type DispatchDecision } from './index.js'

function d(taskId: string, action: string, ts: string, detail?: Record<string, unknown>): DispatchDecision {
  return { taskId, action, ts, detail }
}

describe('shadow · diff (Stage F1 L1)', () => {
  it('case 1: identical streams have driftRate 0', () => {
    const left = [d('t1', 'dispatch', '2026-05-27T00:00:00Z')]
    const right = [d('t1', 'dispatch', '2026-05-27T00:00:00Z')]
    const r = diffStreams('python', left, right)
    expect(r.driftRate).toBe(0)
    expect(r.agree).toBe(1)
  })

  it('case 2: a single disagreement gives driftRate = 1/total', () => {
    const left = [d('t1', 'dispatch', '00'), d('t2', 'dispatch', '00')]
    const right = [d('t1', 'hold', '00'), d('t2', 'dispatch', '00')]
    const r = diffStreams('python', left, right)
    expect(r.disagree).toBe(1)
    expect(r.driftRate).toBeCloseTo(0.5)
  })

  it('case 3: a leftOnly decision counts toward drift', () => {
    const left = [d('t1', 'dispatch', '00'), d('t2', 'dispatch', '00')]
    const right = [d('t1', 'dispatch', '00')]
    const r = diffStreams('python', left, right)
    expect(r.leftOnly).toBe(1)
    expect(r.driftRate).toBeCloseTo(0.5)
  })

  it('case 4: only-latest-per-task — earlier decision ignored', () => {
    const left = [d('t1', 'hold', '00'), d('t1', 'dispatch', '01')]
    const right = [d('t1', 'dispatch', '01')]
    const r = diffStreams('python', left, right)
    expect(r.agree).toBe(1)
    expect(r.driftRate).toBe(0)
  })

  it('case 5: drift threshold gate', () => {
    // 999/1000 agree; 1 disagrees → drift 0.001
    const left: DispatchDecision[] = []
    const right: DispatchDecision[] = []
    for (let i = 0; i < 1000; i++) {
      const a = i === 0 ? 'hold' : 'dispatch'
      left.push(d(`t${i}`, 'dispatch', '00'))
      right.push(d(`t${i}`, a, '00'))
    }
    const r = diffStreams('python', left, right)
    expect(r.driftRate).toBeCloseTo(0.001, 5)
    expect(withinThreshold(r, 0.001)).toBe(false) // strictly below
    expect(withinThreshold(r, 0.005)).toBe(true)
  })
})
