import { describe, expect, it } from 'vitest'
import { redactForValidator } from './redact.js'

describe('redactForValidator', () => {
  it('keeps only evidence files validators are allowed to see', () => {
    const out = redactForValidator({
      'diff-summary.md': 'Changed app.ts',
      'test-summary.md': 'pass',
      'transcript-summary.md': 'coder chain',
      'coder-model.txt': 'claude-opus',
      'token-cost.json': '{"cost":10}',
    })

    expect(out.bundle['diff-summary.md']).toBe('Changed app.ts')
    expect(out.bundle['test-summary.md']).toBe('pass')
    expect(out.bundle['transcript-summary.md']).toBeUndefined()
    expect(out.removed).toContain('transcript-summary.md')
    expect(out.removed).toContain('coder-model.txt')
    expect(out.removed).toContain('token-cost.json')
  })

  it('redacts obvious secret assignments inside allowed evidence', () => {
    const out = redactForValidator({
      'test-summary.md': 'API_KEY=abc TOKEN=def SECRET=ghi PASSWORD=jkl',
    })

    expect(out.bundle['test-summary.md']).not.toContain('API_KEY=')
    expect(out.bundle['test-summary.md']).not.toContain('TOKEN=')
    expect(out.bundle['test-summary.md']).not.toContain('SECRET=')
    expect(out.bundle['test-summary.md']).not.toContain('PASSWORD=')
  })
})
