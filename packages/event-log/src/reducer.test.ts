import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  FileEventLog,
  fold,
  toArray,
  hashIdempotency,
  type Event,
  type Reducer,
} from './index.js'

async function tmpdir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'event-log-'))
}

function baseInput(overrides: Partial<{
  task_id: string
  actor: string
  kind: string
  payload: Record<string, unknown>
  ts: string
  idempotency_source: string
}> = {}) {
  return {
    task_id: 'task_demo',
    actor: 'daemon',
    kind: 'task.status.changed',
    payload: { to: 'running' },
    ...overrides,
  }
}

interface CountState {
  total: number
  byKind: Record<string, number>
}

const countReducer: Reducer<CountState> = (s, e) => ({
  total: s.total + 1,
  byKind: { ...s.byKind, [e.kind]: (s.byKind[e.kind] ?? 0) + 1 },
})

describe('event-log · reducer round-trip invariants (Stage A.1 L1)', () => {
  it('case 1: empty log reduces to initial state', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    const out = await log.reduce<CountState>('task_demo', { total: 0, byKind: {} }, countReducer)
    expect(out).toEqual({ total: 0, byKind: {} })
  })

  it('case 2: single event reduces to incremented state', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    await log.append(baseInput({ idempotency_source: 'a' }))
    const out = await log.reduce<CountState>('task_demo', { total: 0, byKind: {} }, countReducer)
    expect(out.total).toBe(1)
    expect(out.byKind['task.status.changed']).toBe(1)
  })

  it('case 3: associativity — reduce(reduce(E1), E2) === reduce(E1++E2)', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    for (let i = 0; i < 4; i++) await log.append(baseInput({ idempotency_source: `e${i}` }))
    await log.append(baseInput({ kind: 'task.run.completed', idempotency_source: 'last' }))

    const events = await toArray(log.read('task_demo'))
    expect(events.length).toBe(5)
    const mid = Math.floor(events.length / 2)
    const e1 = events.slice(0, mid)
    const e2 = events.slice(mid)

    const initial: CountState = { total: 0, byKind: {} }
    const direct = events.reduce<CountState>(countReducer, initial)
    const left = e1.reduce<CountState>(countReducer, initial)
    const composed = e2.reduce<CountState>(countReducer, left)
    expect(composed).toEqual(direct)
  })

  it('case 4: deletion+replay equivalence — drop derived state, rebuild from log, byte-equal', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    for (let i = 0; i < 6; i++) {
      await log.append(baseInput({ idempotency_source: `r${i}`, kind: i % 2 ? 'task.status.changed' : 'mission.run.advanced' }))
    }
    const first = await log.reduce<CountState>('task_demo', { total: 0, byKind: {} }, countReducer)
    // Simulate "drop SQLite": throw away the derived state, rebuild from on-disk log.
    const fresh = new FileEventLog({ dir })
    const second = await fresh.reduce<CountState>('task_demo', { total: 0, byKind: {} }, countReducer)
    expect(JSON.stringify(second)).toEqual(JSON.stringify(first))
  })

  it('case 5: idempotency — same idempotency key dedupes (key appears at most once)', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    const key = hashIdempotency('same-side-effect')
    const id1 = await log.append({ ...baseInput(), idempotency: key })
    const id2 = await log.append({ ...baseInput(), idempotency: key, payload: { to: 'failed' } })
    expect(id1).toBeTruthy()
    expect(id2).toBeTruthy()
    const events = await toArray(log.read('task_demo'))
    expect(events.length).toBe(1)
    expect(events[0].idempotency).toBe(key)
  })

  it('case 6: idempotency survives restart — second process still rejects duplicate', async () => {
    const dir = await tmpdir()
    const key = hashIdempotency('cross-restart')
    const a = new FileEventLog({ dir })
    await a.append({ ...baseInput(), idempotency: key })
    const b = new FileEventLog({ dir })
    await b.append({ ...baseInput(), idempotency: key, payload: { to: 'failed' } })
    const events = await toArray(b.read('task_demo'))
    expect(events.length).toBe(1)
  })

  it('case 7: monthly rotation — events in two months reduce in chronological order', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    await log.append({ ...baseInput({ ts: '2026-04-15T10:00:00.000Z', idempotency_source: 'apr' }) })
    await log.append({ ...baseInput({ ts: '2026-05-15T10:00:00.000Z', idempotency_source: 'may' }) })
    await log.append({ ...baseInput({ ts: '2026-04-20T10:00:00.000Z', idempotency_source: 'apr2', kind: 'task.run.completed' }) })

    const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.ndjson')).sort()
    expect(files).toEqual(['events-2026-04.ndjson', 'events-2026-05.ndjson'])

    const events = await toArray(log.read('task_demo'))
    const tss = events.map((e) => e.ts)
    const sorted = [...tss].sort()
    expect(tss).toEqual(sorted)
    expect(events.length).toBe(3)
  })

  it('case 8: fromTs cursor — reducer can resume from a timestamp', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    await log.append({ ...baseInput({ ts: '2026-05-01T00:00:00.000Z', idempotency_source: 'x1' }) })
    await log.append({ ...baseInput({ ts: '2026-05-02T00:00:00.000Z', idempotency_source: 'x2' }) })
    await log.append({ ...baseInput({ ts: '2026-05-03T00:00:00.000Z', idempotency_source: 'x3' }) })

    const out = await log.reduce<CountState>(
      'task_demo',
      { total: 0, byKind: {} },
      countReducer,
      '2026-05-02T00:00:00.000Z',
    )
    expect(out.total).toBe(2)
  })

  it('case 9: cross-task isolation — reducer for task A ignores task B events', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    await log.append({ ...baseInput({ task_id: 'task_a', idempotency_source: 'a1' }) })
    await log.append({ ...baseInput({ task_id: 'task_b', idempotency_source: 'b1' }) })
    await log.append({ ...baseInput({ task_id: 'task_a', idempotency_source: 'a2' }) })

    const a = await log.reduce<CountState>('task_a', { total: 0, byKind: {} }, countReducer)
    const b = await log.reduce<CountState>('task_b', { total: 0, byKind: {} }, countReducer)
    expect(a.total).toBe(2)
    expect(b.total).toBe(1)
  })

  it('case 10: causation chain — every event reachable to root via causation_id', async () => {
    const dir = await tmpdir()
    const log = new FileEventLog({ dir })
    const root = await log.append({ ...baseInput({ idempotency_source: 'root' }) })
    const child = await log.append({
      ...baseInput({ kind: 'task.run.started', idempotency_source: 'child' }),
      causation_id: root,
    })
    const grand = await log.append({
      ...baseInput({ kind: 'task.run.completed', idempotency_source: 'grand' }),
      causation_id: child,
    })

    const events = await toArray(log.read('task_demo'))
    const byId = new Map(events.map((e) => [e.id, e]))
    function traceToRoot(id: string): string[] {
      const chain: string[] = []
      let cur: string | null | undefined = id
      while (cur) {
        chain.push(cur)
        const e = byId.get(cur)
        cur = e?.causation_id ?? null
      }
      return chain
    }
    expect(traceToRoot(grand)).toEqual([grand, child, root])
  })
})

describe('event-log · fold helper', () => {
  it('folds an async iterable identical to Array#reduce', async () => {
    async function* gen(): AsyncIterable<Event> {
      const dir = await tmpdir()
      const log = new FileEventLog({ dir })
      const a = await log.append(baseInput({ idempotency_source: 'g1' }))
      const b = await log.append(baseInput({ idempotency_source: 'g2', kind: 'task.run.completed' }))
      void a
      void b
      for await (const e of log.read('task_demo')) yield e
    }
    const result = await fold<CountState>(gen(), { total: 0, byKind: {} }, countReducer)
    expect(result.total).toBe(2)
  })
})
