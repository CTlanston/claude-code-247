import type { ValidatorResult, MergePolicyDecision } from '@aedev/core'

export class MergePolicy {
  decide(score: number, validatorResults: ValidatorResult[]): MergePolicyDecision {
    if (score >= 60) return 'BLOCKED'

    // Check validator results
    const passes = validatorResults.filter((r) => r.verdict === 'pass')
    const fails = validatorResults.filter((r) => r.verdict === 'fail')
    const hasFail = fails.length > 0
    const hasDisagreement = passes.length > 0 && fails.length > 0

    if (hasFail || hasDisagreement) return 'WAITING'
    if (score >= 30) return 'WAITING'

    // Low risk + all validators pass (or no validators)
    return 'AUTO_MERGE'
  }
}
