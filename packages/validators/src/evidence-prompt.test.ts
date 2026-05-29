import { describe, it, expect } from 'vitest'
import { buildEvidencePrompt, parseVerdictPayload } from './evidence-prompt.js'

describe('buildEvidencePrompt', () => {
  it('includes every expected file with (missing) markers when absent', () => {
    const prompt = buildEvidencePrompt({ taskId: 't', bundle: {} })
    expect(prompt).toContain('### plan.md')
    expect(prompt).toContain('### diff-summary.md')
    expect(prompt).toContain('### test-summary.md')
    expect(prompt).toContain('### done-report.md')
    expect(prompt).toContain('(missing)')
    expect(prompt).toContain('Task ID: t')
  })

  it('marks screenshot and preview evidence as optional gates by default', () => {
    const prompt = buildEvidencePrompt({ taskId: 't', bundle: {} })
    expect(prompt).toContain('### screenshot-report.md (optional gate evidence)')
    expect(prompt).toContain('required only when the mission explicitly needs UI screenshot evidence')
    expect(prompt).toContain('### preview-url.txt (optional gate evidence)')
    expect(prompt).toContain('required only when the mission explicitly needs external preview deployment')
  })

  it('explains that task id and mission id may differ', () => {
    const prompt = buildEvidencePrompt({ taskId: 'task-1', bundle: {} })
    expect(prompt).toContain('Evidence may also reference a parent Mission ID')
  })

  it('surfaces unknown files as "extra" so the model can still see them', () => {
    const prompt = buildEvidencePrompt({ taskId: 't', bundle: { 'plan.md': 'a', 'weird.json': '{}' } })
    expect(prompt).toContain('### weird.json (extra)')
  })

  it('truncates very long files', () => {
    const big = 'x'.repeat(20_000)
    const prompt = buildEvidencePrompt({ taskId: 't', bundle: { 'plan.md': big } })
    expect(prompt).toContain('truncated')
  })
})

describe('parseVerdictPayload', () => {
  it('extracts a valid pass payload', () => {
    const out = parseVerdictPayload(JSON.stringify({ verdict: 'pass', summary: 'ok', reasons: ['a', 'b'] }))
    expect(out.verdict).toBe('pass')
    expect(out.summary).toBe('ok')
    expect(out.reasons).toEqual(['a', 'b'])
  })

  it('recovers a JSON object embedded in prose', () => {
    const out = parseVerdictPayload(`Here's the verdict: ${JSON.stringify({ verdict: 'fail', summary: 's', reasons: [] })} — done.`)
    expect(out.verdict).toBe('fail')
    expect(out.summary).toBe('s')
  })

  it('returns inconclusive on truly unparseable input', () => {
    const out = parseVerdictPayload('not even close to JSON')
    expect(out.verdict).toBe('inconclusive')
    expect(out.summary).toContain('not valid JSON')
  })

  it('normalizes unknown verdict strings to inconclusive', () => {
    const out = parseVerdictPayload(JSON.stringify({ verdict: 'maybe', summary: '', reasons: [] }))
    expect(out.verdict).toBe('inconclusive')
  })
})
