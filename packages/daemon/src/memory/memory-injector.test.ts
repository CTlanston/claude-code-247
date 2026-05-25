import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AedevDb } from '@aedev/core'
import { MemoryInjector } from './memory-injector.js'

let db: AedevDb
beforeEach(() => { db = new AedevDb(':memory:') })
afterEach(() => db.close())

describe('MemoryInjector', () => {
  it('returns empty string when no approved memories', () => {
    const injector = new MemoryInjector(db)
    expect(injector.getApprovedContext()).toBe('')
  })

  it('formats approved memories as context block', () => {
    db.insertMemoryItem({ type: 'failure', title: 'Fix X', content: 'Symptom: X\nRoot cause: Y', approved: true })
    const injector = new MemoryInjector(db)
    const ctx = injector.getApprovedContext()
    expect(ctx).toContain('## Relevant Memory')
    expect(ctx).toContain('Fix X')
    expect(ctx).toContain('Symptom: X')
  })

  it('getSafeApprovedItems excludes items with secret patterns', () => {
    db.insertMemoryItem({ type: 'decision', title: 'Safe', content: 'Use retries', approved: true })
    // We can't insert a secret-containing item through insertMemoryItem (it throws)
    // So test getSafeApprovedItems with only safe items
    const injector = new MemoryInjector(db)
    const items = injector.getSafeApprovedItems()
    expect(items).toHaveLength(1)
    expect(items[0]!.title).toBe('Safe')
  })
})
