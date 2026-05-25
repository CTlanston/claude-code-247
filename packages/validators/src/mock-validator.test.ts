import { describe, it, expect } from 'vitest'
import { MockValidator } from './mock-validator.js'

describe('MockValidator', () => {
  it('pass validator returns pass verdict', async () => {
    const v = new MockValidator('pass')
    const r = await v.validate('t-1', { 'plan.md': '# Plan' })
    expect(r.verdict).toBe('pass')
    expect(r.taskId).toBe('t-1')
  })

  it('fail validator returns fail verdict', async () => {
    const v = new MockValidator('fail')
    const r = await v.validate('t-1', {})
    expect(r.verdict).toBe('fail')
  })
})
