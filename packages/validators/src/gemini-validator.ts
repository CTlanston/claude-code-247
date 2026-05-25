import type { ValidatorResult } from '@aedev/core'
import { generateId, nowIso } from '@aedev/core'
import { buildEvidencePrompt, parseVerdictPayload } from './evidence-prompt.js'

/**
 * Gemini validator (REST adapter — no SDK).  Calls the Google Generative
 * Language API directly to keep `@aedev/validators` lightweight.
 *
 * Per ADR-0008/0009 §validators: receives only the evidence bundle, never
 * source code or Coder context.  Returns a typed `ValidatorResult` whose
 * verdict is the model's `pass`/`fail`/`inconclusive` decision.  On any HTTP
 * or parse error the verdict is `inconclusive` (never fail, never silently
 * pass) so the merge policy correctly blocks the merge.
 */
export interface GeminiValidatorOptions {
  apiKey?: string
  model?: string
  fetchFn?: typeof fetch
  timeoutMs?: number
}

const DEFAULT_MODEL = 'gemini-2.5-pro'
const DEFAULT_TIMEOUT_MS = 60_000

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> }
}
interface GeminiResponse {
  candidates?: GeminiCandidate[]
}

export class GeminiValidator {
  private readonly apiKey: string | undefined
  private readonly model: string
  private readonly fetchFn: typeof fetch
  private readonly timeoutMs: number

  constructor(opts: GeminiValidatorOptions = {}) {
    this.apiKey = opts.apiKey ?? process.env['AEDEV_GEMINI_API_KEY']
    this.model = opts.model ?? DEFAULT_MODEL
    this.fetchFn = opts.fetchFn ?? globalThis.fetch
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult> {
    if (!this.apiKey) {
      throw new Error('GeminiValidator requires AEDEV_GEMINI_API_KEY (or pass apiKey option)')
    }

    const prompt = buildEvidencePrompt({ taskId, bundle })
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${this.apiKey}`

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.timeoutMs)

    let verdict: 'pass' | 'fail' | 'inconclusive' = 'inconclusive'
    let summary = ''
    try {
      const resp = await this.fetchFn(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0,
          },
        }),
        signal: controller.signal,
      })
      if (!resp.ok) {
        const errText = await resp.text()
        summary = `Gemini HTTP ${resp.status}: ${errText.slice(0, 200)}`
      } else {
        const data = (await resp.json()) as GeminiResponse
        const text = extractGeminiText(data)
        const parsed = parseVerdictPayload(text)
        verdict = parsed.verdict
        summary = parsed.summary || `Gemini verdict: ${verdict}`
      }
    } catch (e) {
      summary = `Gemini error: ${(e as Error).message}`
    } finally {
      clearTimeout(timer)
    }

    return {
      id: generateId(),
      taskId,
      runId: `gemini-${generateId().slice(0, 8)}`,
      validator: 'gemini',
      verdict,
      summary,
      createdAt: nowIso(),
    }
  }
}

function extractGeminiText(r: GeminiResponse): string {
  const parts = r.candidates?.[0]?.content?.parts ?? []
  for (const p of parts) {
    if (typeof p.text === 'string' && p.text.length > 0) return p.text
  }
  return ''
}
