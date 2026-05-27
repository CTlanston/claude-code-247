import { describe, it, expect } from 'vitest'
import { QuotaOracle, StaticBillingSurface } from './index.js'

describe('cli-robust · quota oracle (Stage M1 L1)', () => {
  it('case 1: exact match → withinTolerance + residual 0', async () => {
    const oracle = new QuotaOracle()
    for (let i = 0; i < 100; i++) oracle.record()
    const v = await oracle.compare(new StaticBillingSurface(100))
    expect(v.residualFraction).toBe(0)
    expect(v.withinTolerance).toBe(true)
  })

  it('case 2: 3% drift → within default ±5% tolerance', async () => {
    const oracle = new QuotaOracle()
    for (let i = 0; i < 97; i++) oracle.record() // 3% under
    const v = await oracle.compare(new StaticBillingSurface(100))
    expect(v.residualFraction).toBeCloseTo(0.03, 5)
    expect(v.withinTolerance).toBe(true)
  })

  it('case 3: 7% drift → OUTSIDE default ±5% tolerance', async () => {
    const oracle = new QuotaOracle()
    for (let i = 0; i < 93; i++) oracle.record() // 7% under
    const v = await oracle.compare(new StaticBillingSurface(100))
    expect(v.residualFraction).toBeCloseTo(0.07, 5)
    expect(v.withinTolerance).toBe(false)
  })

  it('case 4: configurable tolerance', async () => {
    const oracle = new QuotaOracle({ tolerance: 0.10 })
    for (let i = 0; i < 93; i++) oracle.record() // 7% under
    const v = await oracle.compare(new StaticBillingSurface(100))
    expect(v.withinTolerance).toBe(true)
  })

  it('case 5: resetBucket() zeros the estimate', () => {
    const oracle = new QuotaOracle()
    for (let i = 0; i < 50; i++) oracle.record()
    expect(oracle.estimate()).toBe(50)
    oracle.resetBucket()
    expect(oracle.estimate()).toBe(0)
  })

  it('case 6: degenerate billing=0 returns sane verdict', async () => {
    const oracle = new QuotaOracle()
    const v1 = await oracle.compare(new StaticBillingSurface(0))
    expect(v1.residualFraction).toBe(0)
    expect(v1.withinTolerance).toBe(true)

    oracle.record()
    const v2 = await oracle.compare(new StaticBillingSurface(0))
    expect(v2.residualFraction).toBe(1)
    expect(v2.withinTolerance).toBe(false)
  })

  it('case 7: workbook target — 1000-call run with random ±3% noise stays in tolerance', async () => {
    const oracle = new QuotaOracle()
    // Simulate a 1000-call day; the local estimate undercounts by 30 calls
    // (3% drift — within ±5% target).
    for (let i = 0; i < 970; i++) oracle.record()
    const v = await oracle.compare(new StaticBillingSurface(1000))
    expect(v.withinTolerance).toBe(true)
    expect(v.residualFraction).toBeLessThan(0.05)
  })
})
