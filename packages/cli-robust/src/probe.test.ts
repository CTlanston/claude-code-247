import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray, type Event } from '@aedev/event-log'
import { SessionProbe } from './probe.js'
import { QuotaTracker } from './quota.js'
import { reduceHealth, sessionHealthReducer, INITIAL_SESSION_HEALTH } from './health-reducer.js'
import type { ProbeFn } from './types.js'

async function mkLogDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'cli-robust-'))
}

function fakeClock(): { now: () => Date; advance: (ms: number) => void } {
  let cursor = Date.UTC(2026, 4, 26, 12, 0, 0) // 2026-05-26T12:00:00Z
  return {
    now: () => new Date(cursor),
    advance: (ms) => {
      cursor += ms
    },
  }
}

function okProbe(): ProbeFn {
  return async () => ({ ok: true, ts: new Date().toISOString() })
}

function badProbe(): ProbeFn {
  return async () => ({
    ok: false,
    ts: new Date().toISOString(),
    reason: 'session_expired',
    detail: { hint: 'keychain returned no token' },
  })
}

describe('cli-robust · SessionProbe (Stage B.1 L1)', () => {
  it('case 1: healthy probe emits cli.session.probed and nothing else', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const probe = new SessionProbe({ log, taskId: 'task_b', probe: okProbe() })
    await probe.tick()
    const events = await toArray(log.read('task_b'))
    expect(events.map((e) => e.kind)).toEqual(['cli.session.probed'])
    expect((events[0].payload as { ok: boolean }).ok).toBe(true)
  })

  it('case 2: failing probe emits .probed then .expired, with causation chain', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const probe = new SessionProbe({ log, taskId: 'task_b', probe: badProbe() })
    await probe.tick()
    const events = await toArray(log.read('task_b'))
    expect(events.map((e) => e.kind)).toEqual([
      'cli.session.probed',
      'cli.session.expired',
    ])
    expect(events[1].causation_id).toBe(events[0].id)
  })

  it('case 3: HOLD opens within 15 min of first observed expiration', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const clock = fakeClock()
    const probe = new SessionProbe({
      log,
      taskId: 'task_b',
      probe: badProbe(),
      now: clock.now,
    })
    // First failing tick at T=0
    await probe.tick()
    // Tick again 14 minutes later — still no HOLD
    clock.advance(14 * 60 * 1000)
    await probe.tick()
    const beforeHoldEvents = await toArray(log.read('task_b'))
    expect(beforeHoldEvents.find((e) => e.kind === 'hold.policy.created')).toBeUndefined()
    // Tick at 15min01 — HOLD opens
    clock.advance(60 * 1000 + 1)
    await probe.tick()
    const afterHoldEvents = await toArray(log.read('task_b'))
    const hold = afterHoldEvents.find((e) => e.kind === 'hold.policy.created')
    expect(hold).toBeDefined()
    expect((hold!.payload as { reason: string }).reason).toBe('session_expired')
  })

  it('case 4: hold is idempotent — repeated ticks during the same expiration window do not re-open', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const clock = fakeClock()
    const probe = new SessionProbe({
      log,
      taskId: 'task_b',
      probe: badProbe(),
      now: clock.now,
    })
    await probe.tick()
    clock.advance(16 * 60 * 1000)
    await probe.tick() // opens hold
    clock.advance(60 * 1000)
    await probe.tick() // would re-open without idempotency
    clock.advance(60 * 1000)
    await probe.tick()
    const events = await toArray(log.read('task_b'))
    const holds = events.filter((e) => e.kind === 'hold.policy.created')
    expect(holds.length).toBe(1)
  })

  it('case 5: successful probe clears the expiration anchor (no HOLD after recovery)', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const clock = fakeClock()
    let okToggle = false
    const flapping: ProbeFn = async () => {
      okToggle = !okToggle
      return okToggle
        ? { ok: true, ts: new Date().toISOString() }
        : { ok: false, ts: new Date().toISOString(), reason: 'session_expired' }
    }
    const probe = new SessionProbe({ log, taskId: 'task_b', probe: flapping, now: clock.now })
    await probe.tick() // ok=true
    clock.advance(60 * 1000)
    await probe.tick() // ok=false (anchor set)
    clock.advance(20 * 60 * 1000)
    await probe.tick() // ok=true (anchor cleared before grace check)
    const events = await toArray(log.read('task_b'))
    const holds = events.filter((e) => e.kind === 'hold.policy.created')
    expect(holds.length).toBe(0)
  })
})

describe('cli-robust · QuotaTracker (Stage B.1 L1)', () => {
  it('case 6: under threshold — no events emitted', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const quota = new QuotaTracker({
      log,
      taskId: 'task_b',
      policy: { dailyLimit: 100, warnAtFraction: 0.8 },
    })
    for (let i = 0; i < 50; i++) await quota.record()
    const events = await toArray(log.read('task_b'))
    expect(events.length).toBe(0)
    expect(quota.snapshot().fraction).toBeCloseTo(0.5, 5)
  })

  it('case 7: crossing warn threshold emits cli.quota.threshold exactly once', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const quota = new QuotaTracker({
      log,
      taskId: 'task_b',
      policy: { dailyLimit: 100, warnAtFraction: 0.5 },
    })
    for (let i = 0; i < 80; i++) await quota.record()
    const events = await toArray(log.read('task_b'))
    const warns = events.filter((e) => e.kind === 'cli.quota.threshold')
    expect(warns.length).toBe(1)
    expect((warns[0].payload as { callsToday: number }).callsToday).toBe(50)
  })

  it('case 8: 1000 calls against a 1000 cap fires HOLD-quota-exhausted once', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const quota = new QuotaTracker({
      log,
      taskId: 'task_b',
      policy: { dailyLimit: 1000, warnAtFraction: 0.9 },
    })
    for (let i = 0; i < 1000; i++) await quota.record()
    const events = await toArray(log.read('task_b'))
    const holds = events.filter(
      (e) =>
        e.kind === 'hold.policy.created' &&
        (e.payload as { reason: string }).reason === 'quota_exhausted',
    )
    expect(holds.length).toBe(1)
    expect(quota.snapshot().exhausted).toBe(true)
  })

  it('case 9: UTC day rollover resets the bucket', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    const clock = fakeClock()
    const quota = new QuotaTracker({
      log,
      taskId: 'task_b',
      policy: { dailyLimit: 10, warnAtFraction: 0.9 },
      now: clock.now,
    })
    for (let i = 0; i < 10; i++) await quota.record() // exhausts
    clock.advance(25 * 60 * 60 * 1000) // jump > 24h
    await quota.record()
    expect(quota.snapshot().callsToday).toBe(1)
    expect(quota.snapshot().exhausted).toBe(false)
  })
})

describe('cli-robust · session_health view (Stage B.1 L1)', () => {
  it('case 10: reducer reflects healthy → expired transition from events alone', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    let mode: 'ok' | 'bad' = 'ok'
    const probe = new SessionProbe({
      log,
      taskId: 'task_b',
      probe: async () =>
        mode === 'ok'
          ? { ok: true, ts: new Date().toISOString() }
          : { ok: false, ts: new Date().toISOString(), reason: 'session_expired' },
    })
    await probe.tick() // healthy
    mode = 'bad'
    await probe.tick() // expired
    const events = await toArray(log.read('task_b'))
    const view = reduceHealth(events as Event[])
    expect(view.status).toBe('expired')
    expect(view.probes).toBe(2)
    expect(view.lastOkTs).not.toBeNull()
    expect(view.lastExpiredTs).not.toBeNull()
  })

  it('case 11: reducer pure-function — replay yields same view from the log alone', async () => {
    const dir = await mkLogDir()
    const log = new FileEventLog({ dir })
    let mode: 'ok' | 'bad' = 'ok'
    const probe = new SessionProbe({
      log,
      taskId: 'task_b',
      probe: async () =>
        mode === 'ok'
          ? { ok: true, ts: new Date().toISOString() }
          : { ok: false, ts: new Date().toISOString(), reason: 'session_expired' },
    })
    await probe.tick()
    mode = 'bad'
    await probe.tick()
    await probe.tick()
    mode = 'ok'
    await probe.tick()

    const live = await log.reduce(
      'task_b',
      INITIAL_SESSION_HEALTH,
      sessionHealthReducer,
    )
    // Re-open the log fresh and reduce again — must be byte-equal.
    const fresh = new FileEventLog({ dir })
    const replayed = await fresh.reduce(
      'task_b',
      INITIAL_SESSION_HEALTH,
      sessionHealthReducer,
    )
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(live))
    expect(live.status).toBe('healthy') // last event was a healthy probe
  })
})
