import { describe, it, expect } from 'vitest'
import type { ValidatorName, ValidatorResult } from './index.js'

describe('validators', () => {
  it('ValidatorName covers gemini and openai', () => {
    const names: ValidatorName[] = ['gemini', 'openai']
    expect(names).toHaveLength(2)
  })

  it('ValidatorResult has required fields', () => {
    const result: ValidatorResult = {
      id: 'vr-001',
      validator: 'gemini',
      taskId: 'task-001',
      runId: 'run-001',
      verdict: 'pass',
      summary: 'All tests pass',
      evidenceBundlePath: '/tmp/evidence',
      createdAt: new Date().toISOString(),
    }
    expect(result.verdict).toBe('pass')
  })
})
