/** External validator adapters (Gemini + OpenAI). */

// Re-export core types for backward compatibility
export type { ValidatorName, ValidatorVerdict, ValidatorResult, MergePolicyDecision } from '@aedev/core'

export { RiskScorer } from './risk-scorer.js'
export type { RiskFactors, RiskScoreResult } from './risk-scorer.js'
export { MergePolicy } from './merge-policy.js'
export type { MergePolicyEvidence } from './merge-policy.js'
export { EvidenceReviewer } from './reviewer.js'
export type { ReviewResult } from './reviewer.js'
export { MockValidator } from './mock-validator.js'
export { GeminiValidator } from './gemini-validator.js'
export type { GeminiValidatorOptions } from './gemini-validator.js'
export { OpenAIValidator } from './openai-validator.js'
export type { OpenAIValidatorOptions } from './openai-validator.js'
export { buildEvidencePrompt, parseVerdictPayload } from './evidence-prompt.js'
export { redactForValidator } from './redact.js'
export type { RedactedEvidence } from './redact.js'
export { assertDifferentFamily, FamilyConflictError } from './family-enforce.js'
export type { ValidatorFamily } from './family-enforce.js'
export {
  DefaultIndependentJudgeContextBuilder,
  StaticGitDiffFetcher,
  type GitDiffSpec,
  type GitDiffResult,
  type GitDiffFetcher,
  type IndependentJudgeContext,
  type IndependentJudgeContextBuilder,
} from './git-fetch-context.js'
