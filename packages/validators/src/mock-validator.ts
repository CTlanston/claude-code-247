import type { ValidatorResult, ValidatorVerdict } from '@aedev/core'
import { generateId, nowIso } from '@aedev/core'

export class MockValidator {
  constructor(private verdict: ValidatorVerdict = 'pass') {}

  async validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult> {
    return {
      id: generateId(),
      taskId,
      runId: 'mock-run',
      validator: 'mock',
      verdict: this.verdict,
      summary: `Mock validator returned: ${this.verdict}. Bundle has ${Object.keys(bundle).length} files.`,
      createdAt: nowIso(),
    }
  }
}
