import type { ValidatorResult, MergePolicyDecision } from '@aedev/core'

/** Additional evidence/context the merge policy can inspect.  All fields optional. */
export interface MergePolicyEvidence {
  /** Filename → content map of the evidence bundle the dual validators saw. */
  bundle?: Record<string, string>
  /** True if the mission touched UI — screenshot evidence becomes mandatory. */
  requiresScreenshots?: boolean
  /** True if external preview deployment was required — preview smoke must have passed. */
  requiresPreview?: boolean
  /** True if any secret-scan hit was recorded.  Blocks auto-merge unconditionally. */
  secretScanHit?: boolean
  /** True if the diff touched a forbidden path (`.env*`, `secrets/**`, etc.).  Blocks. */
  forbiddenPathTouched?: boolean
  /** True if the mission is in a sensitive lane (auth/payment/security/deploy). */
  sensitiveLane?: boolean
  /** Model family that authored the candidate diff. */
  coderFamily?: 'anthropic' | 'openai' | 'google' | 'mock'
  /** When true, two passing validators must be from families other than coderFamily. */
  requireIndependentValidatorFamilies?: boolean
}

export class MergePolicy {
  /**
   * Decide the merge outcome for a completed task.
   *
   * Rules (applied in priority order):
   *
   * 1. Secret-scan hit OR forbidden-path touched → BLOCKED regardless of everything else.
   * 2. Score ≥ 60 (high risk) → BLOCKED regardless of validators.
   * 3. Any validator verdict is 'fail' → BLOCKED.
   * 4. No validator results supplied → WAITING (safety-first: require evidence).
   * 5. Any validator verdict is 'inconclusive' → WAITING.
   * 6. Fewer than 2 passing validators → WAITING.
   * 7. requiresScreenshots and no screenshot evidence in bundle → WAITING.
   * 8. requiresPreview and no preview-url.txt in bundle → WAITING.
   * 9. Sensitive lane → WAITING (medium risk minimum, requires human).
   * 10. Score ≥ 30 (medium risk) → WAITING.
   * 11. Low risk (< 30) + at least 2 validators + all pass + UI gates satisfied → AUTO_MERGE.
   *
   * The function can therefore NEVER return AUTO_MERGE with zero validators,
   * one validator, any failure, any inconclusive result, missing screenshot
   * evidence on a UI mission, missing preview on an external-preview mission,
   * a secret-scan hit, a forbidden-path touch, or a sensitive lane.
   */
  decide(
    score: number,
    validatorResults: ValidatorResult[],
    evidence: MergePolicyEvidence = {},
  ): MergePolicyDecision {
    // 1. Safety blocks first
    if (evidence.secretScanHit) return 'BLOCKED'
    if (evidence.forbiddenPathTouched) return 'BLOCKED'

    // 2. High risk always blocks
    if (score >= 60) return 'BLOCKED'

    // 3. Any failure always blocks (even if another validator passed)
    const hasFail = validatorResults.some((r) => r.verdict === 'fail')
    if (hasFail) return 'BLOCKED'

    // 4. No validators — wait for human
    if (validatorResults.length === 0) return 'WAITING'

    // 5. Any inconclusive result — wait for human
    const hasInconclusive = validatorResults.some((r) => r.verdict === 'inconclusive')
    if (hasInconclusive) return 'WAITING'

    // 6. Need at least two passing validators, and when a coder family is
    // known for a dual-validation hard gate, both passes must be independent
    // of that family.  Example: Codex(OpenAI) coder + OpenAI validator counts
    // as same-family and cannot satisfy a "two independent verdicts" gate.
    const passes = validatorResults.filter((r) => r.verdict === 'pass')
    if (passes.length < 2) return 'WAITING'
    if (evidence.requireIndependentValidatorFamilies ?? Boolean(evidence.coderFamily)) {
      const independentPasses = passes.filter((r) => validatorFamily(r.validator) !== evidence.coderFamily)
      const independentFamilies = new Set(independentPasses.map((r) => validatorFamily(r.validator)))
      if (independentPasses.length < 2 || independentFamilies.size < 2) return 'WAITING'
    }

    // 7. UI gate — screenshot evidence required
    if (evidence.requiresScreenshots) {
      if (!hasScreenshotEvidence(evidence.bundle)) return 'WAITING'
    }

    // 8. External preview gate — preview URL required
    if (evidence.requiresPreview) {
      if (!hasPreviewUrl(evidence.bundle)) return 'WAITING'
    }

    // 9. Sensitive lane always requires human approval
    if (evidence.sensitiveLane) return 'WAITING'

    // 10. Medium risk — wait for human even with dual validators
    if (score >= 30) return 'WAITING'

    // 11. Low risk + dual pass + UI/preview gates satisfied — safe to auto-merge
    return 'AUTO_MERGE'
  }
}

function validatorFamily(name: ValidatorResult['validator']): 'anthropic' | 'openai' | 'google' | 'mock' {
  switch (name) {
    case 'gemini': return 'google'
    case 'openai':
    case 'codex': return 'openai'
    case 'mock':
    default: return 'mock'
  }
}

function hasScreenshotEvidence(bundle: Record<string, string> | undefined): boolean {
  if (!bundle) return false
  const expected = 'screenshot-report.md'
  if (bundle[expected]) {
    const content = bundle[expected]
    // Reject stub content from Phase 5's QA role template (Pending).
    if (/Status:\s*Pending/i.test(content)) return false
    // Need actual screenshot file references.
    return /screenshot-\w+\.png/i.test(content) || /✅/.test(content)
  }
  return false
}

function hasPreviewUrl(bundle: Record<string, string> | undefined): boolean {
  if (!bundle) return false
  const url = bundle['preview-url.txt']
  if (!url) return false
  return /^https?:\/\//i.test(url.trim())
}
