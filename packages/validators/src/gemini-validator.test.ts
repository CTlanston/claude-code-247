/**
 * Real-behavior tests for GeminiValidator.  An injected fetchFn returns
 * canned Gemini-shaped responses so the full pipeline (prompt build →
 * HTTP body → JSON parse → ValidatorResult) is exercised without
 * network access.
 */
import { describe, it, expect } from 'vitest'
import { GeminiValidator } from './gemini-validator.js'

function fakeFetch(payload: unknown, opts: { status?: number; text?: string } = {}): typeof fetch {
  return (async () => {
    if (opts.status && opts.status !== 200) {
      return new Response(opts.text ?? 'err', { status: opts.status })
    }
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
  }) as typeof fetch
}

const SAMPLE_BUNDLE = {
  'plan.md': '# Plan\n\nDo the thing.',
  'diff-summary.md': '# Diff\n\nAdded one file.',
  'test-summary.md': '# Tests\n\n3 passed.',
  'done-report.md': '# Done\n\nAll good.',
}

describe('GeminiValidator', () => {
  it('parses a pass verdict from a clean JSON response', async () => {
    const v = new GeminiValidator({
      apiKey: 'fake',
      fetchFn: fakeFetch({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: 'pass', summary: 'Looks good', reasons: ['tests pass', 'low risk'] }) }] } }],
      }),
    })
    const result = await v.validate('task-1', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('pass')
    expect(result.summary).toBe('Looks good')
    expect(result.validator).toBe('gemini')
    expect(result.taskId).toBe('task-1')
  })

  it('parses a fail verdict and surfaces the model summary', async () => {
    const v = new GeminiValidator({
      apiKey: 'fake',
      fetchFn: fakeFetch({
        candidates: [{ content: { parts: [{ text: JSON.stringify({ verdict: 'fail', summary: 'Missing tests', reasons: [] }) }] } }],
      }),
    })
    const result = await v.validate('task-2', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('fail')
    expect(result.summary).toBe('Missing tests')
  })

  it('returns inconclusive when the model wraps JSON in prose', async () => {
    // The parser tolerates a JSON object embedded in surrounding text — should still extract the verdict.
    const v = new GeminiValidator({
      apiKey: 'fake',
      fetchFn: fakeFetch({
        candidates: [{ content: { parts: [{ text: `Here is the verdict: ${JSON.stringify({ verdict: 'inconclusive', summary: 'Not enough info', reasons: [] })} — done.` }] } }],
      }),
    })
    const result = await v.validate('task-3', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('inconclusive')
    expect(result.summary).toBe('Not enough info')
  })

  it('returns inconclusive on HTTP error (never silently passes)', async () => {
    const v = new GeminiValidator({
      apiKey: 'fake',
      fetchFn: fakeFetch(null, { status: 500, text: 'internal error' }),
    })
    const result = await v.validate('task-4', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('inconclusive')
    expect(result.summary).toContain('HTTP 500')
  })

  it('returns inconclusive when the response is not parseable JSON', async () => {
    const v = new GeminiValidator({
      apiKey: 'fake',
      fetchFn: fakeFetch({
        candidates: [{ content: { parts: [{ text: 'I am a chatty model and forgot the JSON.' }] } }],
      }),
    })
    const result = await v.validate('task-5', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('inconclusive')
    expect(result.summary).toContain('not valid JSON')
  })

  it('throws when no API key is configured', async () => {
    const original = process.env['AEDEV_GEMINI_API_KEY']
    delete process.env['AEDEV_GEMINI_API_KEY']
    try {
      const v = new GeminiValidator()
      await expect(v.validate('task-6', SAMPLE_BUNDLE)).rejects.toThrow(/AEDEV_GEMINI_API_KEY/)
    } finally {
      if (original !== undefined) process.env['AEDEV_GEMINI_API_KEY'] = original
    }
  })

  it('aborts on timeout and returns inconclusive', async () => {
    const slowFetch: typeof fetch = (async (_url, init) => {
      const signal = (init as RequestInit | undefined)?.signal
      return new Promise<Response>((_, reject) => {
        if (!signal) return
        const onAbort = (): void => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
        if (signal.aborted) onAbort()
        else signal.addEventListener('abort', onAbort)
      })
    }) as typeof fetch
    const v = new GeminiValidator({ apiKey: 'fake', fetchFn: slowFetch, timeoutMs: 50 })
    const result = await v.validate('task-7', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('inconclusive')
    expect(result.summary).toContain('error')
  })
})

const smoke = process.env['AEDEV_SMOKE_GEMINI'] === '1' ? describe : describe.skip

smoke('GeminiValidator — smoke against real Gemini (opt-in)', () => {
  it('returns a real verdict for a known-pass evidence bundle', async () => {
    const v = new GeminiValidator()
    const result = await v.validate('smoke-pass', SAMPLE_BUNDLE)
    expect(['pass', 'fail', 'inconclusive']).toContain(result.verdict)
    expect(result.validator).toBe('gemini')
  }, 90_000)
})
