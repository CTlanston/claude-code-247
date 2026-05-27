import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog } from '@aedev/event-log'
import {
  InterruptService,
  Escalator,
  HoldRepository,
  HOLD_POLICIES,
  policyFor,
  type HoldReason,
} from './index.js'

async function mkLog(): Promise<{ dir: string; log: FileEventLog; md: string }> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'ibus-'))
  const md = path.join(dir, 'holds.md')
  return { dir, log: new FileEventLog({ dir }), md }
}

function clock(start = Date.UTC(2026, 4, 27, 12, 0, 0)) {
  let t = start
  return { now: () => new Date(t), advance: (ms: number) => { t += ms } }
}

const ALL_REASONS: HoldReason[] = [
  'session_expired',
  'quota_exhausted',
  'secret_grant_request',
  'validator_disagreement',
  'production_incident',
  'forbidden_path_push',
  'sentinel_rejected',
]

describe('interrupt-bus · policy table (Stage C L1)', () => {
  it('case 1: all 7 reasons have an explicit policy', () => {
    for (const r of ALL_REASONS) {
      const p = policyFor(r)
      expect(p).toBeDefined()
      expect(typeof p.ttlMs).toBe('number')
      expect(['retry-3', 'drop', 'escalate', 'halt']).toContain(p.onTimeout)
    }
    expect(Object.keys(HOLD_POLICIES).length).toBe(7)
  })

  it('case 2: halt-class reasons (secret_grant, production, forbidden_path) have infinite ttl', () => {
    expect(policyFor('secret_grant_request').ttlMs).toBe(Infinity)
    expect(policyFor('production_incident').ttlMs).toBe(Infinity)
    expect(policyFor('forbidden_path_push').ttlMs).toBe(Infinity)
  })
})

describe('interrupt-bus · open/resolve cycle (Stage C L1)', () => {
  it('case 3: opening each of 7 reasons emits an event with payload.reason + appears in repo snapshot', async () => {
    const { log, md } = await mkLog()
    const svc = new InterruptService({ log, holdsMdPath: md })
    const repo = new HoldRepository(log)
    const ids: string[] = []
    for (let i = 0; i < ALL_REASONS.length; i++) {
      const reason = ALL_REASONS[i]
      ids.push(await svc.open({ taskId: `task_c_${i}`, reason }))
    }
    // each reason in its own task — snapshotForTask returns one each
    for (let i = 0; i < ALL_REASONS.length; i++) {
      const holds = await repo.snapshotForTask(`task_c_${i}`)
      expect(holds.length).toBe(1)
      expect(holds[0].reason).toBe(ALL_REASONS[i])
      expect(holds[0].status).toBe('open')
    }
    expect(ids.length).toBe(7)
  })

  it('case 4: holds.md is written for every hold open', async () => {
    const { log, md } = await mkLog()
    const svc = new InterruptService({ log, holdsMdPath: md })
    await svc.open({ taskId: 'task_c', reason: 'validator_disagreement' })
    const text = await fs.readFile(md, 'utf8')
    expect(text).toMatch(/HOLD OPEN {2}validator_disagreement/)
  })

  it('case 5: resolve flips status to resolved and appends holds.md', async () => {
    const { log, md } = await mkLog()
    const svc = new InterruptService({ log, holdsMdPath: md })
    const repo = new HoldRepository(log)
    const id = await svc.open({ taskId: 'task_c', reason: 'validator_disagreement' })
    await svc.resolve({ taskId: 'task_c', holdId: id, by: 'operator' })
    const holds = await repo.snapshotForTask('task_c')
    expect(holds[0].status).toBe('resolved')
    const text = await fs.readFile(md, 'utf8')
    expect(text).toMatch(/HOLD RESOLVED/)
  })
})

describe('interrupt-bus · escalator policy (Stage C L1)', () => {
  it('case 6: session_expired holds get retry-3 then drop after TTL expiry', async () => {
    const { log, md } = await mkLog()
    const c = clock()
    const svc = new InterruptService({ log, holdsMdPath: md, now: c.now })
    const repo = new HoldRepository(log)
    const esc = new Escalator({ service: svc, repo, now: c.now })

    await svc.open({ taskId: 'task_c', reason: 'session_expired' })
    // not yet expired
    expect(await esc.sweep()).toBe(0)
    c.advance(5 * 60 * 1000 + 1) // > 5 min ttl
    expect(await esc.sweep()).toBe(1) // retry 1
    expect(await esc.sweep()).toBe(1) // retry 2
    expect(await esc.sweep()).toBe(1) // retry 3
    expect(await esc.sweep()).toBe(1) // drop
    const holds = await repo.snapshotForTask('task_c')
    expect(holds[0].status).toBe('dropped')
    expect(holds[0].retries).toBe(3)
  })

  it('case 7: validator_disagreement escalates at TTL expiry', async () => {
    const { log, md } = await mkLog()
    const c = clock()
    const svc = new InterruptService({ log, holdsMdPath: md, now: c.now })
    const repo = new HoldRepository(log)
    const esc = new Escalator({ service: svc, repo, now: c.now })
    await svc.open({ taskId: 'task_c', reason: 'validator_disagreement' })
    c.advance(30 * 60 * 1000 + 1)
    expect(await esc.sweep()).toBe(1)
    const holds = await repo.snapshotForTask('task_c')
    expect(holds[0].status).toBe('escalated')
  })

  it('case 8: halt-class holds never auto-resolve (secret_grant_request stays open after 24h)', async () => {
    const { log, md } = await mkLog()
    const c = clock()
    const svc = new InterruptService({ log, holdsMdPath: md, now: c.now })
    const repo = new HoldRepository(log)
    const esc = new Escalator({ service: svc, repo, now: c.now })
    await svc.open({ taskId: 'task_c', reason: 'secret_grant_request' })
    c.advance(24 * 60 * 60 * 1000)
    expect(await esc.sweep()).toBe(0)
    const holds = await repo.snapshotForTask('task_c')
    expect(holds[0].status).toBe('open')
  })

  it('case 9: same anchor + reason dedupes hold-opens (idempotency)', async () => {
    const { log, md } = await mkLog()
    const svc = new InterruptService({ log, holdsMdPath: md })
    const repo = new HoldRepository(log)
    const id1 = await svc.open({ taskId: 'task_c', reason: 'forbidden_path_push' })
    const id2 = await svc.open({ taskId: 'task_c', reason: 'forbidden_path_push' })
    // second call dedupes — same id returned
    expect(id1).toBe(id2)
    const holds = await repo.snapshotForTask('task_c')
    expect(holds.length).toBe(1)
  })
})
