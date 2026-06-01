import type { ValidatorResult } from '@aedev/core'
import { generateId, nowIso } from '@aedev/core'
import { buildEvidencePrompt, parseVerdictPayload } from './evidence-prompt.js'

/**
 * OpenAI-compatible validator (REST adapter — no SDK).  Calls the
 * chat-completions API directly with `response_format: { type: "json_object" }`
 * so the model is forced to emit valid JSON.
 *
 * Per ADR-0008/0009 §validators: receives only the evidence bundle, never
 * source code or Coder context.  On HTTP/parse error returns `inconclusive`
 * so the merge policy blocks merge instead of silently passing.
 */
export interface OpenAIValidatorOptions {
  apiKey?: string
  model?: string
  baseUrl?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

// gpt-4o-mini proved too weak to reliably read a multi-file evidence bundle (it
// reported present files as "missing" and invented contradictions → a false
// inconclusive that wrongly blocked a merge). Default to a capable model so the
// validator actually reads the evidence, matching Gemini's tier. Override with
// AEDEV_OPENAI_MODEL. (P6 s_0042.)
const DEFAULT_MODEL = 'gpt-4o'
const DEFAULT_BASE_URL = 'https://api.openai.com/v1'
const DEFAULT_TIMEOUT_MS = 60_000

interface OpenAIChatResponse {
  choices?: Array<{ message?: { content?: string } }>
}

export class OpenAIValidator {
  private readonly apiKey: string | undefined
  private readonly model: string
  private readonly baseUrl: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: OpenAIValidatorOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env['AEDEV_OPENAI_API_KEY']
    this.model = opts.model ?? process.env['AEDEV_OPENAI_MODEL'] ?? DEFAULT_MODEL
    this.baseUrl = (opts.baseUrl ?? process.env['AEDEV_OPENAI_BASE_URL'] ?? DEFAULT_BASE_URL).replace(/\/$/, '')
    this.fetchFn = opts.fetchFn ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult> {
    if (!this.apiKey) {
      throw new Error('OpenAIValidator requires AEDEV_OPENAI_API_KEY (or pass apiKey option)')
    }

    const prompt = buildEvidencePrompt({ taskId, bundle })

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let verdict: 'pass' | 'fail' | 'inconclusive' = 'inconclusive'
    let summary = ''
    try {
      const resp = await this.fetchFn(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: this.model,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0,
        }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const errText = await resp.text()
        summary = `OpenAI HTTP ${resp.status}: ${errText.slice(0, 200)}`
      } else {
        const data = (await resp.json()) as OpenAIChatResponse
        const text = data.choices?.[0]?.message?.content ?? ''
        const parsed = parseVerdictPayload(text)
        verdict = parsed.verdict
        summary = parsed.summary || `OpenAI verdict: ${verdict}`
      }
    } catch (e) {
      summary = `OpenAI error: ${(e as Error).message}`
    } finally {
      clearTimeout(timer)
    }

    return {
      id: generateId(),
      taskId,
      runId: `openai-${generateId().slice(0, 8)}`,
      validator: 'openai',
      verdict,
      summary,
      createdAt: nowIso(),
    }
  }
}
