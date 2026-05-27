import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { FileEventLog, toArray } from '@aedev/event-log'
import { Saga, idempotencyKey, type MoveStep } from './index.js'

interface Ctx { sideEffectCount: number; compensated: string[] }

async function mkLog() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'moves-'))
  return { dir, log: new FileEventLog({ dir }) }
}

function dedupedEffect(externalIdempotencyStore: Map<string, true>) {
  /** Real-world side effect surface: re-applies dedupe on its own
   *  idempotency key. The saga's act() passes its idemKey here. */
  return (key: string, onApply: () => void) => {
    if (externalIdempotencyStore.has(key)) return // duplicate; no-op
    externalIdempotencyStore.set(key, true)
    onApply()
  }
}

describe('moves · saga (Stage G L1)', () => {
  it('case 1: idempotencyKey is stable across replays for the same (task, move, step)', () => {
    const a = idempotencyKey('task_g', 'mergePR', 'pushBranch')
    const b = idempotencyKey('task_g', 'mergePR', 'pushBranch')
    expect(a).toBe(b)
    expect(a).toMatch(/^sha256:[0-9a-f]{64}$/)
  })

  it('case 2: happy path — three steps complete, move.advanced emitted', async () => {
    const { log } = await mkLog()
    const ctx: Ctx = { sideEffectCount: 0, compensated: [] }
    const store = new Map<string, true>()
    const apply = dedupedEffect(store)
    const steps: MoveStep<Ctx>[] = [
      { name: 'prepareBranch', act: (c, k) => apply(k, () => c.sideEffectCount++) },
      { name: 'pushBranch',    act: (c, k) => apply(k, () => c.sideEffectCount++) },
      { name: 'openPR',        act: (c, k) => apply(k, () => c.sideEffectCount++) },
    ]
    const saga = new Saga({ log, taskId: 'task_g', moveName: 'mergePR', steps })
    const out = await saga.run(ctx)
    expect(out.status).toBe('completed')
    expect(ctx.sideEffectCount).toBe(3)
    const kinds = (await toArray(log.read('task_g'))).map((e) => e.kind)
    expect(kinds.filter((k) => k === 'move.act.completed').length).toBe(3)
    expect(kinds).toContain('move.fsm.advanced')
  })

  it('case 3: replay 10x — side effect runs exactly once per step (idempotency)', async () => {
    const { log } = await mkLog()
    const ctx: Ctx = { sideEffectCount: 0, compensated: [] }
    const store = new Map<string, true>()
    const apply = dedupedEffect(store)
    const steps: MoveStep<Ctx>[] = [
      { name: 'prepareBranch', act: (c, k) => apply(k, () => c.sideEffectCount++) },
      { name: 'pushBranch',    act: (c, k) => apply(k, () => c.sideEffectCount++) },
    ]
    for (let i = 0; i < 10; i++) {
      const saga = new Saga({ log, taskId: 'task_g', moveName: 'mergePR', steps })
      await saga.run(ctx)
    }
    expect(ctx.sideEffectCount).toBe(2) // 2 steps, each ran exactly once
    // event log dedup makes move.advanced appear exactly once too
    const events = await toArray(log.read('task_g'))
    expect(events.filter((e) => e.kind === 'move.fsm.advanced').length).toBe(1)
    expect(events.filter((e) => e.kind === 'move.act.completed').length).toBe(2)
  })

  it('case 4: failure on step 2 of 3 → step 1 compensates, no advance', async () => {
    const { log } = await mkLog()
    const ctx: Ctx = { sideEffectCount: 0, compensated: [] }
    const steps: MoveStep<Ctx>[] = [
      { name: 'prepareBranch',
        act: (c) => { c.sideEffectCount++ },
        compensate: (c) => { c.compensated.push('prepareBranch') } },
      { name: 'pushBranch',
        act: () => { throw new Error('git push 403') },
        compensate: (c) => { c.compensated.push('pushBranch') } },
      { name: 'openPR',
        act: (c) => { c.sideEffectCount++ } },
    ]
    const saga = new Saga({ log, taskId: 'task_g', moveName: 'mergePR', steps })
    const out = await saga.run(ctx)
    expect(out.status).toBe('compensated')
    expect(out.failedAt).toBe(1)
    expect(ctx.compensated).toEqual(['prepareBranch']) // only step 0 was completed → only it compensates
    const events = await toArray(log.read('task_g'))
    const kinds = events.map((e) => e.kind)
    expect(kinds).toContain('move.act.failed')
    expect(kinds).toContain('move.step.compensated')
    expect(kinds).not.toContain('move.fsm.advanced')
  })

  it('case 5: precondition false → step is skipped (no events for it)', async () => {
    const { log } = await mkLog()
    const ctx: Ctx = { sideEffectCount: 0, compensated: [] }
    const steps: MoveStep<Ctx>[] = [
      { name: 'optional', precondition: () => false, act: (c) => { c.sideEffectCount++ } },
      { name: 'always',                                 act: (c) => { c.sideEffectCount++ } },
    ]
    const saga = new Saga({ log, taskId: 'task_g', moveName: 'mergePR', steps })
    await saga.run(ctx)
    expect(ctx.sideEffectCount).toBe(1)
    const kinds = (await toArray(log.read('task_g'))).map((e) => e.kind)
    expect(kinds.filter((k) => k === 'move.act.completed').length).toBe(1)
  })

  it('case 6: idempotency key drives external-surface dedup across replays', async () => {
    const { log } = await mkLog()
    // External git-push-like surface: same idemKey → exactly one effect.
    const externalCalls: string[] = []
    const externalStore = new Map<string, true>()
    const fakeGit = (k: string) => {
      if (externalStore.has(k)) return // dedup at the surface
      externalStore.set(k, true)
      externalCalls.push(k)
    }
    const steps: MoveStep<Ctx>[] = [
      { name: 'pushBranch', act: (_c, k) => fakeGit(k) },
    ]
    for (let i = 0; i < 5; i++) {
      const saga = new Saga({ log, taskId: 'task_g', moveName: 'mergePR', steps })
      await saga.run({ sideEffectCount: 0, compensated: [] })
    }
    expect(externalCalls.length).toBe(1)
  })

  it('case 7: kill-mid-act simulation — second run continues where the first left off', async () => {
    const { log } = await mkLog()
    const ctx: Ctx = { sideEffectCount: 0, compensated: [] }
    const store = new Map<string, true>()
    const apply = dedupedEffect(store)
    let step2Throws = true
    const steps: MoveStep<Ctx>[] = [
      { name: 'prep',  act: (c, k) => apply(k, () => c.sideEffectCount++) },
      { name: 'push',  act: (c, k) => { if (step2Throws) throw new Error('die'); apply(k, () => c.sideEffectCount++) } },
      { name: 'open',  act: (c, k) => apply(k, () => c.sideEffectCount++) },
    ]
    const a = new Saga({ log, taskId: 'task_g', moveName: 'mergePR', steps })
    const r1 = await a.run(ctx) // dies at push
    expect(r1.status).toBe('compensated')
    expect(ctx.sideEffectCount).toBe(1) // only prep ran
    step2Throws = false
    const b = new Saga({ log, taskId: 'task_g', moveName: 'mergePR', steps })
    const r2 = await b.run(ctx)
    expect(r2.status).toBe('completed')
    // prep was deduped (external store + log idempotency); push + open ran
    expect(ctx.sideEffectCount).toBe(3)
  })
})
