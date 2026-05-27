import { describe, it, expect } from 'vitest'
import { diffStreams, withinThreshold, type DispatchDecision } from './index.js'

/**
 * Stage F1 L1 (compressed 1-day per ADR-0011 bound 2): generate a
 * synthetic 24h-equivalent dispatcher decision stream — ~2400 decisions
 * (1 every ~36 s for a day). Both sides agree by construction with N
 * planted divergences; assert driftRate < 0.001.
 *
 * The literal "two dispatchers in parallel for 24h wall-clock" is
 * deferred to operator-driven GA validation.
 */
describe('shadow · 1-day equivalent run (Stage F1 L1)', () => {
  it('case 1: 2400 decisions both sides identical → drift = 0', () => {
    const left: DispatchDecision[] = []
    const right: DispatchDecision[] = []
    for (let i = 0; i < 2400; i++) {
      const d: DispatchDecision = {
        taskId: `task_${i}`,
        action: i % 7 === 0 ? 'hold' : i % 5 === 0 ? 'skip' : 'dispatch',
        ts: `2026-05-27T00:00:${(i % 60).toString().padStart(2, '0')}Z`,
        detail: { batch: Math.floor(i / 100) },
      }
      left.push({ ...d })
      right.push({ ...d })
    }
    const r = diffStreams('python', left, right)
    expect(r.total).toBe(2400)
    expect(r.driftRate).toBe(0)
  })

  it('case 2: 2 planted disagreements out of 2400 → drift well below 0.001 threshold', () => {
    const left: DispatchDecision[] = []
    const right: DispatchDecision[] = []
    for (let i = 0; i < 2400; i++) {
      const same: DispatchDecision = {
        taskId: `task_${i}`,
        action: 'dispatch',
        ts: '2026-05-27T00:00:00Z',
      }
      left.push(same)
      right.push(i === 1000 || i === 2000 ? { ...same, action: 'hold' } : same)
    }
    const r = diffStreams('python', left, right)
    expect(r.disagree).toBe(2)
    expect(r.driftRate).toBeLessThan(0.001)
    // 2/2400 = 0.000833... — passes the 0.001 gate
    expect(withinThreshold(r, 0.001)).toBe(true)
  })

  it('case 3: drift accumulation over batched windows is detectable', () => {
    const left: DispatchDecision[] = []
    const right: DispatchDecision[] = []
    for (let i = 0; i < 100; i++) {
      left.push({ taskId: `t_${i}`, action: 'dispatch', ts: '2026-05-27T01:00:00Z' })
      right.push({ taskId: `t_${i}`, action: i < 5 ? 'hold' : 'dispatch', ts: '2026-05-27T01:00:00Z' })
    }
    const r = diffStreams('python', left, right)
    // 5/100 = 0.05 — should trip the threshold
    expect(withinThreshold(r, 0.001)).toBe(false)
    expect(r.sample.length).toBeGreaterThan(0)
  })

  it('case 4: latest-decision-per-task collapse removes timing-jitter false drift', () => {
    const left: DispatchDecision[] = [
      { taskId: 't_jitter', action: 'hold', ts: '2026-05-27T00:00:00Z' },
      { taskId: 't_jitter', action: 'dispatch', ts: '2026-05-27T00:00:05Z' },
    ]
    const right: DispatchDecision[] = [
      { taskId: 't_jitter', action: 'hold', ts: '2026-05-27T00:00:01Z' }, // 1s later
      { taskId: 't_jitter', action: 'dispatch', ts: '2026-05-27T00:00:06Z' }, // 1s later
    ]
    const r = diffStreams('python', left, right)
    expect(r.driftRate).toBe(0)
    expect(r.agree).toBe(1)
  })
})
