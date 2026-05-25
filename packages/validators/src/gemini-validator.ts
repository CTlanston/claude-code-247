import type { ValidatorResult } from '@aedev/core'
import { generateId, nowIso } from '@aedev/core'

export class GeminiValidator {
  constructor(private apiKey?: string) {
    this.apiKey = apiKey ?? process.env['AEDEV_GEMINI_API_KEY']
  }

  async validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult> {
    if (!this.apiKey) {
      throw new Error('GeminiValidator requires AEDEV_GEMINI_API_KEY environment variable')
    }
    // Stub — actual Gemini API call to be implemented when API key is available
    return {
      id: generateId(), taskId, runId: 'gemini-run', validator: 'gemini',
      verdict: 'inconclusive',
      summary: `Gemini validator stub — ${Object.keys(bundle).length} evidence files reviewed. Full implementation pending.`,
      createdAt: nowIso(),
    }
  }
}
