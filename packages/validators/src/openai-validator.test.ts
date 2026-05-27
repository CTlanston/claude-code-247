/**
 * Real-behavior tests for OpenAIValidator.  Injects a fetchFn returning
 * canned chat-completion responses.
 */
import { describe, it, expect } from 'vitest'
import { OpenAIValidator } from './openai-validator.js'

function chatResponse(content: string, status = 200): typeof fetch {
  return (async () => {
    if (status !== 200) return new Response('err', { status })
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200, headers: { 'content-type': 'application/json' } },
    )
  }) as typeof fetch
}

const SAMPLE_BUNDLE = {
  'plan.md': '# Plan',
  'diff-summary.md': '# Diff',
  'test-summary.md': '# Tests',
  'done-report.md': '# Done',
}

describe('OpenAIValidator', () => {
  it('parses a pass verdict from a clean JSON response', async () => {
    const v = new OpenAIValidator({
      apiKey: 'fake',
      fetchFn: chatResponse(JSON.stringify({ verdict: 'pass', summary: 'OK', reasons: [] })),
    })
    const result = await v.validate('task-1', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('pass')
    expect(result.summary).toBe('OK')
    expect(result.validator).toBe('openai')
  })

  it('parses a fail verdict', async () => {
    const v = new OpenAIValidator({
      apiKey: 'fake',
      fetchFn: chatResponse(JSON.stringify({ verdict: 'fail', summary: 'Diff does not match plan', reasons: [] })),
    })
    const result = await v.validate('task-2', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('fail')
    expect(result.summary).toBe('Diff does not match plan')
  })

  it('returns inconclusive on HTTP 4xx/5xx', async () => {
    const v = new OpenAIValidator({
      apiKey: 'fake',
      fetchFn: chatResponse('', 429),
    })
    const result = await v.validate('task-3', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('inconclusive')
    expect(result.summary).toContain('HTTP 429')
  })

  it('returns inconclusive when content is unparseable', async () => {
    const v = new OpenAIValidator({
      apiKey: 'fake',
      fetchFn: chatResponse('chatty preamble {not json'),
    })
    const result = await v.validate('task-4', SAMPLE_BUNDLE)
    expect(result.verdict).toBe('inconclusive')
  })

  it('throws when no API key is set', async () => {
    const original = process.env['AEDEV_OPENAI_API_KEY']
    delete process.env['AEDEV_OPENAI_API_KEY']
    try {
      const v = new OpenAIValidator()
      await expect(v.validate('task-5', SAMPLE_BUNDLE)).rejects.toThrow(/AEDEV_OPENAI_API_KEY/)
    } finally {
      if (original !== undefined) process.env['AEDEV_OPENAI_API_KEY'] = original
    }
  })

  it('sends Authorization header and request body shape OpenAI expects', async () => {
    let capturedInit: RequestInit | undefined
    let capturedUrl: string | undefined
    const captureFetch: typeof fetch = (async (url: string | URL | Request, init: RequestInit | undefined) => {
      capturedUrl = String(url)
      capturedInit = init
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: 'pass', summary: 'ok', reasons: [] }) } }] }),
        { status: 200 },
      )
    }) as typeof fetch

    const v = new OpenAIValidator({ apiKey: 'sk-test', fetchFn: captureFetch, model: 'gpt-test' })
    await v.validate('task-headers', SAMPLE_BUNDLE)

    expect(capturedUrl).toBe('https://api.openai.com/v1/chat/completions')
    expect((capturedInit?.headers as Record<string, string>).authorization).toBe('Bearer sk-test')
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>
    expect(body['model']).toBe('gpt-test')
    expect((body['response_format'] as { type: string }).type).toBe('json_object')
  })

  it('honors AEDEV_OPENAI_BASE_URL override', async () => {
    let capturedUrl: string | undefined
    const captureFetch: typeof fetch = (async (url: string | URL | Request) => {
      capturedUrl = String(url)
      return new Response(
        JSON.stringify({ choices: [{ message: { content: JSON.stringify({ verdict: 'pass', summary: '', reasons: [] }) } }] }),
        { status: 200 },
      )
    }) as typeof fetch

    const v = new OpenAIValidator({ apiKey: 'k', baseUrl: 'https://my-proxy.example/v1', fetchFn: captureFetch })
    await v.validate('task-base', SAMPLE_BUNDLE)
    expect(capturedUrl).toBe('https://my-proxy.example/v1/chat/completions')
  })
})

// allow-skip: env-gated smoke runner — only fires under AEDEV_SMOKE_OPENAI=1
const smoke = process.env['AEDEV_SMOKE_OPENAI'] === '1' ? describe : describe.skip

smoke('OpenAIValidator — smoke against real OpenAI (opt-in)', () => {
  it('returns a real verdict for a sample evidence bundle', async () => {
    const v = new OpenAIValidator()
    const result = await v.validate('smoke-openai', SAMPLE_BUNDLE)
    expect(['pass', 'fail', 'inconclusive']).toContain(result.verdict)
    expect(result.validator).toBe('openai')
  }, 90_000)
})
