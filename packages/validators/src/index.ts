/** External validator adapters (Gemini + OpenAI). */

/** Supported external validator names. */
export type ValidatorName = 'gemini' | 'openai'

/** Verdict returned by a validator. */
export type ValidatorVerdict = 'pass' | 'fail' | 'inconclusive'

/** A complete validator result for a task. */
export interface ValidatorResult {
  validator: ValidatorName
  taskId: string
  verdict: ValidatorVerdict
  summary: string
  evidenceBundlePath: string
  createdAt: string
}
