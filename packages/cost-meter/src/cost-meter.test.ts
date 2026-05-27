import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import {
  CostTagger, DEFAULT_PRICING,
  CostRoller, gaugesFrom, renderProm,
  CostBreaker,
} from './index.js'

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'cost-meter-'))
  return { dir, log: new FileEventLog({ dir }) }
}

function clock(start = Date.UTC(2026, 4, 27, 12, 0, 0)) {
  let t = start
  return { now: () => new Date(t), advance: (ms: number) => { t += ms } }
}

describe('cost-meter · tagger (L2.1 L1)', () => {
  it('case 1: known model — cost = (in/1M * inPrice) + (out/1M * outPrice)', () => {
    const t = new CostTagger()
    // claude-sonnet-4-6: in=3, out=15 per 1M
    // 100k input + 50k output = 0.1*3 + 0.05*15 = 0.3 + 0.75 = 1.05
    const tag = t.tag({ model: 'claude-sonnet-4-6', inputTokens: 100_000, outputTokens: 50_000 })
    expect(tag.costUsd).toBeCloseTo(1.05, 2)
    expect(tag.model).toBe('claude-sonnet-4-6')
  })

  it('case 2: unknown model → costUsd 0 + model preserved (reconciler can flag)', () => {
    const t = new CostTagger()
    const tag = t.tag({ model: 'claude-unknown-9-9', inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(tag.costUsd).toBe(0)
    expect(t.knows('claude-unknown-9-9')).toBe(false)
  })

  it('case 3: opus prices ~25x sonnet at the same token mix (sanity)', () => {
    const t = new CostTagger()
    const opus = t.tag({ model: 'claude-opus-4-7', inputTokens: 1_000_000, outputTokens: 1_000_000 })
    const sonnet = t.tag({ model: 'claude-sonnet-4-6', inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(opus.costUsd / sonnet.costUsd).toBeCloseTo(5.0, 1) // (15+75)/(3+15)=5
  })

  it('case 4: custom pricing table override works', () => {
    const custom = { 'foo-model-1': { inputPerMillion: 1.0, outputPerMillion: 2.0 } }
    const t = new CostTagger(custom)
    const tag = t.tag({ model: 'foo-model-1', inputTokens: 1_000_000, outputTokens: 1_000_000 })
    expect(tag.costUsd).toBeCloseTo(3.0, 2)
    expect(t.knows('claude-opus-4-7')).toBe(false)
  })

  it('case 5: DEFAULT_PRICING covers the three current Claude tiers', () => {
    expect(DEFAULT_PRICING['claude-opus-4-7']).toBeDefined()
    expect(DEFAULT_PRICING['claude-sonnet-4-6']).toBeDefined()
    expect(DEFAULT_PRICING['claude-haiku-4-5-20251001']).toBeDefined()
  })
})

describe('cost-meter · roller (L2.1 L1)', () => {
  it('case 6: 7d window sums total + groups by bucket', () => {
    const c = clock()
    const r = new CostRoller({ now: c.now })
    r.record({ ts: c.now().toISOString(), costUsd: 2.5, bucket: 'pr-1' })
    r.record({ ts: c.now().toISOString(), costUsd: 3.75, bucket: 'pr-1' })
    r.record({ ts: c.now().toISOString(), costUsd: 1.0, bucket: 'pr-2' })
    const snap = r.snapshot()
    expect(snap.totalUsd).toBeCloseTo(7.25, 2)
    expect(snap.count).toBe(3)
    expect(snap.byBucket['pr-1']).toBeCloseTo(6.25, 2)
    expect(snap.byBucket['pr-2']).toBeCloseTo(1.0, 2)
  })

  it('case 7: samples older than window are evicted', () => {
    const c = clock()
    const r = new CostRoller({ now: c.now, windowMs: 1000 })
    r.record({ ts: c.now().toISOString(), costUsd: 5, bucket: 'pr-old' })
    c.advance(2000) // 2s later — window 1s
    r.record({ ts: c.now().toISOString(), costUsd: 3, bucket: 'pr-new' })
    const snap = r.snapshot()
    expect(snap.count).toBe(1)
    expect(snap.totalUsd).toBeCloseTo(3, 2)
    expect(snap.byBucket['pr-old']).toBeUndefined()
  })

  it('case 8: avgPerBucket is per-mission average', () => {
    const c = clock()
    const r = new CostRoller({ now: c.now })
    r.record({ ts: c.now().toISOString(), costUsd: 2, bucket: 'pr-a' })
    r.record({ ts: c.now().toISOString(), costUsd: 8, bucket: 'pr-b' })
    r.record({ ts: c.now().toISOString(), costUsd: 5, bucket: 'pr-c' })
    // 3 buckets, totals 2/8/5; avg = 15/3 = 5.0
    expect(r.avgPerBucket()).toBeCloseTo(5.0, 2)
  })
})

describe('cost-meter · exporter (L2.1 L1)', () => {
  it('case 9: gaugesFrom returns the 4 expected gauges', () => {
    const c = clock()
    const r = new CostRoller({ now: c.now })
    r.record({ ts: c.now().toISOString(), costUsd: 4, bucket: 'pr-x' })
    r.record({ ts: c.now().toISOString(), costUsd: 6, bucket: 'pr-y' })
    const g = gaugesFrom(r)
    expect(g.cost_total_usd).toBeCloseTo(10, 2)
    expect(g.cost_per_pr_usd_7d).toBeCloseTo(5, 2)
    expect(g.cost_event_count).toBe(2)
    expect(g.cost_bucket_count).toBe(2)
  })

  it('case 10: renderProm produces Prometheus text exposition format', () => {
    const c = clock()
    const r = new CostRoller({ now: c.now })
    r.record({ ts: c.now().toISOString(), costUsd: 3, bucket: 'pr-z' })
    const text = renderProm(gaugesFrom(r))
    expect(text).toMatch(/^# HELP cost_total_usd/m)
    expect(text).toMatch(/^# TYPE cost_total_usd gauge/m)
    expect(text).toMatch(/^cost_total_usd 3/m)
    expect(text).toMatch(/^# TYPE cost_per_pr_usd_7d gauge/m)
  })
})

describe('cost-meter · breaker (GR12)', () => {
  it('case 11: under cap → not tripped, no warning', async () => {
    const { log } = await mkLog()
    const r = new CostRoller()
    r.record({ ts: new Date().toISOString(), costUsd: 2, bucket: 'pr-a' })
    const b = new CostBreaker({ log, taskId: 'task_gr12', roller: r, hardCapUsd: 15 })
    const v = await b.tick()
    expect(v.tripped).toBe(false)
    expect(v.warning).toBe(false)
    expect(b.isTripped()).toBe(false)
  })

  it('case 12: between warn and hard cap → warning event emitted once', async () => {
    const { log } = await mkLog()
    const r = new CostRoller()
    r.record({ ts: new Date().toISOString(), costUsd: 13, bucket: 'pr-a' })
    const b = new CostBreaker({ log, taskId: 'task_gr12', roller: r, hardCapUsd: 15, warnFraction: 0.8 })
    const v = await b.tick()
    expect(v.warning).toBe(true)
    expect(v.tripped).toBe(false)
    // second tick at same level — no second warning event
    await b.tick()
    const events = await toArray(log.read('task_gr12'))
    const warnings = events.filter((e) => e.kind === 'cost.budget.warning')
    expect(warnings.length).toBe(1)
  })

  it('case 13: at/above hard cap → tripped + hold.policy.created (cost_cap_breached)', async () => {
    const { log } = await mkLog()
    const r = new CostRoller()
    r.record({ ts: new Date().toISOString(), costUsd: 16, bucket: 'pr-a' })
    const b = new CostBreaker({ log, taskId: 'task_gr12', roller: r, hardCapUsd: 15 })
    await b.tick()
    expect(b.isTripped()).toBe(true)
    const events = await toArray(log.read('task_gr12'))
    const hold = events.find((e) => e.kind === 'hold.policy.created')
    expect(hold).toBeDefined()
    expect((hold!.payload as { reason: string }).reason).toBe('cost_cap_breached')
  })

  it('case 14: tripped → second tick does NOT emit a second hold (idempotent)', async () => {
    const { log } = await mkLog()
    const r = new CostRoller()
    r.record({ ts: new Date().toISOString(), costUsd: 16, bucket: 'pr-a' })
    const b = new CostBreaker({ log, taskId: 'task_gr12', roller: r, hardCapUsd: 15 })
    await b.tick()
    await b.tick()
    await b.tick()
    const events = await toArray(log.read('task_gr12'))
    const holds = events.filter((e) =>
      e.kind === 'hold.policy.created' &&
      (e.payload as { reason: string }).reason === 'cost_cap_breached',
    )
    expect(holds.length).toBe(1)
  })

  it('case 15: anti-thrash — even if cost drops below cap, breaker stays tripped until reset()', async () => {
    const { log } = await mkLog()
    const c = clock()
    const r = new CostRoller({ now: c.now, windowMs: 1000 })
    r.record({ ts: c.now().toISOString(), costUsd: 16, bucket: 'pr-a' })
    const b = new CostBreaker({ log, taskId: 'task_gr12', roller: r, hardCapUsd: 15 })
    await b.tick()
    expect(b.isTripped()).toBe(true)
    // evict the expensive sample by advancing past the window
    c.advance(2000)
    r.record({ ts: c.now().toISOString(), costUsd: 1, bucket: 'pr-b' })
    expect(b.inspect().observedCostPerPr).toBeLessThan(15)
    // breaker is still tripped
    expect(b.isTripped()).toBe(true)
    // explicit operator-equivalent reset
    b.reset()
    expect(b.isTripped()).toBe(false)
  })
})
