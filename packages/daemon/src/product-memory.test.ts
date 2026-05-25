import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import { ProductMemory } from './product-memory.js'

let db: AedevDb
let mem: ProductMemory

beforeEach(() => {
  db = new AedevDb(':memory:')
  mem = new ProductMemory(db)
})

afterEach(() => {
  db.close()
})

describe('ProductMemory', () => {
  it('records a memory item with the given category type', () => {
    const item = mem.record('design-preference', 'Use dark mode', 'User prefers high-contrast dark UI.')
    expect(item.type).toBe('design-preference')
    expect(item.approved).toBe(false)
  })

  it('recall() only returns approved items for the requested category', () => {
    const a = mem.record('stack-preference', 'Prefer pnpm', 'Use pnpm over npm.')
    mem.record('stack-preference', 'Avoid yarn', 'Yarn is not allowed.')
    mem.approve(a.id)

    const recalled = mem.recall('stack-preference')
    expect(recalled).toHaveLength(1)
    expect(recalled[0]?.title).toBe('Prefer pnpm')
  })

  it('list() returns ALL items for the category (approved + pending)', () => {
    mem.record('architecture-convention', 'Prefer functional core', 'Push side effects out.')
    mem.record('architecture-convention', 'Module per concept', 'One file per concept.')
    const items = mem.list('architecture-convention')
    expect(items).toHaveLength(2)
  })

  it('recordFailurePattern stores a failure signature with the right shape', () => {
    // No FK constraint for sourceTaskId at the schema level; it's TEXT references tasks(id)
    // but allowed to be null.  Still, we test without it here.
    const item = mem.recordFailurePattern({
      signature: 'a1b2c3d4e5f6',
      description: 'Same TypeError when prop is undefined.',
    })
    expect(item.type).toBe('failure-pattern')
    expect(item.title).toContain('a1b2c3d4')
  })

  it('categories do not bleed into each other', () => {
    mem.record('design-preference', 'd1', 'd1')
    const stack = mem.record('stack-preference', 's1', 's1')
    mem.approve(stack.id)
    expect(mem.recall('design-preference')).toHaveLength(0)
    expect(mem.recall('stack-preference')).toHaveLength(1)
  })

  it('repoId filtering works on recall', () => {
    const r1 = db.insertRepo({
      name: 'r1', path: '/tmp/r1', defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const r2 = db.insertRepo({
      name: 'r2', path: '/tmp/r2', defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: [], riskRules: {}, mergePolicy: 'WAITING',
    })
    const a = mem.record('design-preference', 'd-r1', 'r1 only', { repoId: r1.id })
    const b = mem.record('design-preference', 'd-r2', 'r2 only', { repoId: r2.id })
    mem.approve(a.id); mem.approve(b.id)
    expect(mem.recall('design-preference', { repoId: r1.id })).toHaveLength(1)
    expect(mem.recall('design-preference', { repoId: r2.id })).toHaveLength(1)
  })
})
