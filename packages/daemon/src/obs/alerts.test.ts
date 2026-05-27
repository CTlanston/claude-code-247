import { describe, it, expect } from 'vitest'
import { evaluateAlerts, DEFAULT_ALERT_ROUTES, type SloSnapshot } from './index.js'

const HEALTHY: SloSnapshot = {
  costPerPrUsd7d: 4.5,        // well under 80% of 15
  hardCapUsd: 15,
  holdMttrP95Min: 12,         // well under 30
  daemonUptimePct: 99.7,      // > 99.0
  sentinelFalseBlockRate: 0.02,
  redteamPassRate: 1.0,       // ideal
}

describe('obs · alert routes (L2.2 L1)', () => {
  it('case 1: 4 routes registered (cost / hold-overrun / redteam-leak / uptime)', () => {
    const ids = Object.keys(DEFAULT_ALERT_ROUTES).sort()
    expect(ids).toEqual(['cost', 'hold-overrun', 'redteam-leak', 'uptime'])
  })

  it('case 2: healthy snapshot → no alerts fire', () => {
    expect(evaluateAlerts(HEALTHY)).toEqual([])
  })

  it('case 3: cost at 80% cap → warn but not critical', () => {
    const r = evaluateAlerts({ ...HEALTHY, costPerPrUsd7d: 12 })
    expect(r.length).toBe(1)
    expect(r[0].route).toBe('cost')
    expect(r[0].severity).toBe('warn')
  })

  it('case 4: cost ≥ hard cap → critical (GR12)', () => {
    const r = evaluateAlerts({ ...HEALTHY, costPerPrUsd7d: 15.5 })
    expect(r.length).toBe(1)
    expect(r[0].route).toBe('cost')
    expect(r[0].severity).toBe('critical')
    expect(r[0].message).toMatch(/GR12 breached/)
  })

  it('case 5: hold MTTR over 30 min → warn', () => {
    const r = evaluateAlerts({ ...HEALTHY, holdMttrP95Min: 45 })
    expect(r.length).toBe(1)
    expect(r[0].route).toBe('hold-overrun')
    expect(r[0].severity).toBe('warn')
  })

  it('case 6: redteam pass rate < 1.0 → critical (one prompt slipped through)', () => {
    const r = evaluateAlerts({ ...HEALTHY, redteamPassRate: 0.97 })
    expect(r.length).toBe(1)
    expect(r[0].route).toBe('redteam-leak')
    expect(r[0].severity).toBe('critical')
  })

  it('case 7: uptime below 99% → warn', () => {
    const r = evaluateAlerts({ ...HEALTHY, daemonUptimePct: 98.5 })
    expect(r.length).toBe(1)
    expect(r[0].route).toBe('uptime')
    expect(r[0].severity).toBe('warn')
  })

  it('case 8: multiple breaches → multiple alerts in stable order', () => {
    const r = evaluateAlerts({
      ...HEALTHY,
      costPerPrUsd7d: 16,
      holdMttrP95Min: 45,
      redteamPassRate: 0.9,
      daemonUptimePct: 95.0,
    })
    expect(r.map((a) => a.route)).toEqual(['cost', 'hold-overrun', 'redteam-leak', 'uptime'])
    expect(r.find((a) => a.route === 'cost')!.severity).toBe('critical')
  })
})
