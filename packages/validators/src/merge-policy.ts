import type { ValidatorResult, MergePolicyDecision } from '@aedev/core'

export class MergePolicy {
  /**
   * Decide the merge outcome for a completed task.
   *
   * Rules (applied in priority order):
   *
   * 1. Score ≥ 60 (high risk) → BLOCKED regardless of validators.
   * 2. Any validator verdict is 'fail' → BLOCKED.
   * 3. No validator results supplied → WAITING (safety-first: require evidence).
   * 4. Any validator verdict is 'inconclusive' → WAITING.
   * 5. Fewer than 2 passing validators → WAITING.
   * 6. Score ≥ 30 (medium risk) → WAITING.
   * 7. Low risk (< 30) + at least 2 validators + all pass → AUTO_MERGE.
   *
   * The function can therefore NEVER return AUTO_MERGE with zero validators,
   * one validator, any failure, or any inconclusive result.
   */
  decide(score: number, validatorResults: ValidatorResult[]): MergePolicyDecision {
    // 1. High risk always blocks
    if (score >= 60) return 'BLOCKED'

    // 2. Any failure always blocks (even if another validator passed)
    const hasFail = validatorResults.some((r) => r.verdict === 'fail')
    if (hasFail) return 'BLOCKED'

    // 3. No validators — wait for human
    if (validatorResults.length === 0) return 'WAITING'

    // 4. Any inconclusive result — wait for human
    const hasInconclusive = validatorResults.some((r) => r.verdict === 'inconclusive')
    if (hasInconclusive) return 'WAITING'

    // 5. Need at least two independent passing validators
    const passes = validatorResults.filter((r) => r.verdict === 'pass')
    if (passes.length < 2) return 'WAITING'

    // 6. Medium risk — wait for human even with dual validators
    if (score >= 30) return 'WAITING'

    // 7. Low risk + dual pass — safe to auto-merge
    return 'AUTO_MERGE'
  }
}
