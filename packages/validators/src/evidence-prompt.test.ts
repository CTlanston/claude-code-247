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

  it('redacts unknown files instead of surfacing them to validators', () => {
    const prompt = buildEvidencePrompt({ taskId: 't', bundle: { 'plan.md': 'a', 'weird.json': '{}' } })
    expect(prompt).not.toContain('### weird.json')
    expect(prompt).toContain('Redacted evidence files: weird.json')
  })

  it('truncates very long files', () => {
    const big = 'x'.repeat(20_000)
    const prompt = buildEvidencePrompt({ taskId: 't', bundle: { 'plan.md': big } })
    expect(prompt).toContain('truncated')
  })

  it('does not leak coder transcript, model, retry, or cost evidence', () => {
    const prompt = buildEvidencePrompt({
      taskId: 't',
      bundle: {
        'diff-summary.md': 'safe diff',
        'coder-transcript.txt': 'CODER_TRANSCRIPT_SHOULD_NOT_LEAK',
        'model-name.txt': 'MODEL_NAME_SHOULD_NOT_LEAK',
        'retry-count.txt': 'RETRY_COUNT_SHOULD_NOT_LEAK',
        'token-cost.json': 'TOKEN_COST_SHOULD_NOT_LEAK',
      },
    })

    expect(prompt).toContain('safe diff')
    expect(prompt).not.toContain('CODER_TRANSCRIPT_SHOULD_NOT_LEAK')
    expect(prompt).not.toContain('MODEL_NAME_SHOULD_NOT_LEAK')
    expect(prompt).not.toContain('RETRY_COUNT_SHOULD_NOT_LEAK')
    expect(prompt).not.toContain('TOKEN_COST_SHOULD_NOT_LEAK')
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
