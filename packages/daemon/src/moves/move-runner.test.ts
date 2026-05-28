import { mkdtempSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import { AedevDb } from '@aedev/core'
import { BoundedMoveRunner, moveIdempotencyKey } from './index.js'

describe('BoundedMoveRunner', () => {
  it('runs bounded moves and writes evidence', async () => {
    const db = new AedevDb()
    const evidenceDir = mkdtempSync(join(tmpdir(), 'aedev-moves-'))
    const runner = new BoundedMoveRunner<{ count: number }>({ db, taskId: 'task-1', evidenceDir })

    const out = await runner.run({ count: 0 }, [
      { id: 'one', title: 'One', run: async (ctx) => ({ count: ctx.count + 1 }) },
      { id: 'two', title: 'Two', run: async (ctx) => ({ count: ctx.count + 1 }) },
    ])

    expect(out.ctx.count).toBe(2)
    expect(out.completed).toEqual(['one', 'two'])
    expect(JSON.parse(readFileSync(join(evidenceDir, 'move-manifest.json'), 'utf8'))).toMatchObject({
      completed: ['one', 'two'],
      skipped: [],
    })
  })

  it('recovers by skipping previously completed moves', async () => {
    const db = new AedevDb()
    const evidenceDir = mkdtempSync(join(tmpdir(), 'aedev-moves-recover-'))
    db.insertEvent('move.completed', 'task', 'task-1', { moveId: 'one' })
    const runner = new BoundedMoveRunner<{ count: number }>({ db, taskId: 'task-1', evidenceDir })

    const out = await runner.run({ count: 0 }, [
      { id: 'one', title: 'One', run: async (ctx) => ({ count: ctx.count + 100 }) },
      { id: 'two', title: 'Two', run: async (ctx) => ({ count: ctx.count + 1 }) },
    ])

    expect(out.ctx.count).toBe(1)
    expect(out.skipped).toEqual(['one'])
    expect(out.completed).toEqual(['two'])
  })

  it('fails timed out moves instead of hanging indefinitely', async () => {
    const db = new AedevDb()
    const runner = new BoundedMoveRunner<{ ok: boolean }>({
      db,
      taskId: 'task-1',
      evidenceDir: mkdtempSync(join(tmpdir(), 'aedev-moves-timeout-')),
      defaultTimeoutMs: 20,
    })

    const out = await runner.run({ ok: true }, [
      { id: 'slow', title: 'Slow', run: async (ctx) => new Promise((resolve) => setTimeout(() => resolve(ctx), 200)) },
    ])

    expect(out.failed?.id).toBe('slow')
    expect(out.failed?.error).toMatch(/timed out/)
  })
})

describe('moveIdempotencyKey', () => {
  it('is deterministic per task and move', () => {
    expect(moveIdempotencyKey('t1', 'm1')).toBe(moveIdempotencyKey('t1', 'm1'))
    expect(moveIdempotencyKey('t1', 'm1')).not.toBe(moveIdempotencyKey('t1', 'm2'))
  })
})
