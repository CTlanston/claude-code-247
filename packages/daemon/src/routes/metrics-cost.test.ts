import { afterEach, describe, expect, it } from 'vitest'
import { AedevDb } from '@aedev/core'
import { CostRoller } from '@aedev/cost-meter'
import { createServer } from '../server.js'

describe('/metrics — cost-meter rolling-window gauges', () => {
  let db: AedevDb
  afterEach(() => db?.close())

  it('appends real cost gauges from the wired roller', async () => {
    db = new AedevDb(':memory:')
    const roller = new CostRoller()
    roller.record({ ts: new Date().toISOString(), costUsd: 0.27, bucket: 'm1' })
    const app = createServer(db, new Date(), undefined, {}, roller)
    const res = await app.inject({ method: 'GET', url: '/metrics' })
    expect(res.statusCode).toBe(200)
    expect(res.body).toContain('cost_total_usd 0.27')
    expect(res.body).toContain('cost_per_pr_usd_7d')
    expect(res.body).toContain('cost_bucket_count 1')
    // base obs metrics still present alongside cost
    expect(res.body).toContain('events_total')
    await app.close()
  })

  it('omits cost gauges when no roller is wired (e.g. bare createServer / tests)', async () => {
    db = new AedevDb(':memory:')
    const app = createServer(db, new Date())
    const res = await app.inject({ method: 'GET', url: '/metrics' })
    expect(res.body).toContain('events_total')
    expect(res.body).not.toContain('cost_total_usd')
    await app.close()
  })
})
