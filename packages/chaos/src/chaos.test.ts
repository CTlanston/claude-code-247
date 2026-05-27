import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import { ChaosInjector, ChaosScheduler, ALL_DRILLS, DRILL_BY_NAME, type DrillName } from './index.js'

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'chaos-'))
  return { dir, log: new FileEventLog({ dir }) }
}

describe('chaos · drills (Stage I L1)', () => {
  it('case 1: ALL_DRILLS contains exactly 5 entries per workbook §3 Stage I', () => {
    expect(ALL_DRILLS.length).toBe(5)
    const names = ALL_DRILLS.map((d) => d.name).sort()
    expect(names).toEqual(
      ['drop_network', 'expire_session', 'fill_disk', 'kill_worker', 'sqlite_write_lock'].sort(),
    )
  })

  it('case 2: each drill named in workbook is registered in DRILL_BY_NAME', () => {
    const expected: DrillName[] = ['kill_worker', 'fill_disk', 'drop_network', 'expire_session', 'sqlite_write_lock']
    for (const n of expected) expect(DRILL_BY_NAME[n]).toBeDefined()
  })

  it('case 3: runOnce emits chaos.drill.injected with the drill name', async () => {
    const { log } = await mkLog()
    const inj = new ChaosInjector({ log })
    await inj.runOnce('kill_worker')
    const events = await toArray(log.read('task_chaos'))
    const fired = events.find((e) => e.kind === 'chaos.drill.injected')
    expect(fired).toBeDefined()
    expect((fired!.payload as { drill: string }).drill).toBe('kill_worker')
  })

  it('case 4: drills with cleanup emit chaos.drill.cleaned afterward', async () => {
    const { log } = await mkLog()
    const inj = new ChaosInjector({ log })
    await inj.runOnce('fill_disk')
    const kinds = (await toArray(log.read('task_chaos'))).map((e) => e.kind)
    expect(kinds).toContain('chaos.drill.injected')
    expect(kinds).toContain('chaos.drill.cleaned')
  })

  it('case 5: runFullSuite emits 5 injection events (one per drill)', async () => {
    const { log } = await mkLog()
    const inj = new ChaosInjector({ log })
    await inj.runFullSuite()
    const events = await toArray(log.read('task_chaos'))
    const injected = events.filter((e) => e.kind === 'chaos.drill.injected')
    expect(injected.length).toBe(5)
    const drills = new Set(injected.map((e) => (e.payload as { drill: string }).drill))
    expect(drills.size).toBe(5)
  })

  it('case 6: runRandom with a seed is deterministic', async () => {
    const { log } = await mkLog()
    const inj = new ChaosInjector({ log })
    const a = await inj.runRandom(7)
    const b = await inj.runRandom(7)
    expect(a).toBe(b)
  })
})

describe('chaos · scheduler (Stage I L1)', () => {
  it('case 7: outside Sunday 03-04 UTC window → no fire', async () => {
    const { log } = await mkLog()
    const inj = new ChaosInjector({ log })
    // Monday 03:30 UTC → wrong day
    const sched = new ChaosScheduler({ injector: inj, now: () => new Date(Date.UTC(2026, 4, 25, 3, 30, 0)) })
    expect(await sched.tick()).toBe(false)
  })

  it('case 8: Sunday 03:30 UTC inside window → fires full suite once', async () => {
    const { log } = await mkLog()
    const inj = new ChaosInjector({ log })
    const sched = new ChaosScheduler({ injector: inj, now: () => new Date(Date.UTC(2026, 4, 31, 3, 30, 0)) })
    expect(await sched.tick()).toBe(true)
    const fired = (await toArray(log.read('task_chaos'))).filter((e) => e.kind === 'chaos.drill.injected')
    expect(fired.length).toBe(5)
  })

  it('case 9: second tick within the same window does NOT re-fire', async () => {
    const { log } = await mkLog()
    const inj = new ChaosInjector({ log })
    let t = Date.UTC(2026, 4, 31, 3, 30, 0)
    const sched = new ChaosScheduler({ injector: inj, now: () => new Date(t) })
    expect(await sched.tick()).toBe(true)
    t += 5 * 60 * 1000 // 5 min later, still in window
    expect(await sched.tick()).toBe(false)
  })
})
