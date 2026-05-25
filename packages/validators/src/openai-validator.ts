import type { ValidatorResult } from '@aedev/core'
import { generateId, nowIso } from '@aedev/core'

export class OpenAIValidator {
  constructor(private apiKey?: string) {
    this.apiKey = apiKey ?? process.env['AEDEV_OPENAI_API_KEY']
  }

  async validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult> {
    if (!this.apiKey) {
      throw new Error('OpenAIValidator requires AEDEV_OPENAI_API_KEY environment variable')
    }
    return {
      id: generateId(), taskId, runId: 'openai-run', validator: 'openai',
      verdict: 'inconclusive',
      summary: `OpenAI validator stub — ${Object.keys(bundle).length} evidence files reviewed. Full implementation pending.`,
      createdAt: nowIso(),
    }
  }
}
