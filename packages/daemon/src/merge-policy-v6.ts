/** WORKBOOK_v6 overnight P4 — the mature-product merge-action policy as a
 * PURE DECISION FUNCTION.
 *
 * Policy doc: docs/product/MERGE_POLICY.md (reconciles docs/AUTO_MERGE_POLICY.md,
 * the legacy v2.x risk-score policy behind @aedev/validators' MergePolicy).
 *
 * HARD SCOPE NOTE (GR#10 — human merge only): auto-merge is DISABLED this
 * cycle.  This module is exported for tests and future wiring ONLY; it is
 * intentionally NOT imported by any merge execution path, and callers in this
 * cycle must pass `autoMergeEnabled: false`, under which the function can
 * never return `auto_merge_eligible` — the strongest outcome is a draft PR
 * that a human merges.
 */

export type V6ChangeKind = 'docs_only' | 'code' | 'security' | 'workflow' | 'dependency' | 'system_config'

export interface MergeActionInput {
  changeKind: V6ChangeKind
  /** True only when the repo's test gate is green for this change. */
  testsGreen: boolean
  /** Evidence-only Gemini hard gate (GR#9: Gemini is the final judge). */
  geminiVerdict: 'pass' | 'fail' | 'inconclusive' | 'not_configured'
  /** In-process Claude cross-engine review verdict ('none' = no review ran). */
  claudeReview: 'approve' | 'rework' | 'none'
  riskLevel: 'low' | 'medium' | 'high'
  /** Operator explicitly approved merging this specific change. */
  explicitApproval: boolean
  /** GR#10: must be false this cycle — auto-merge is disabled product-wide. */
  autoMergeEnabled: boolean
}

export interface MergeActionDecision {
  action: 'auto_merge_eligible' | 'draft_pr_only' | 'hold' | 'no_pr'
  reason: string
}

const SENSITIVE_KINDS: ReadonlySet<V6ChangeKind> = new Set(['security', 'workflow', 'dependency', 'system_config'])

/**
 * Decide the merge action for a completed, validated change.
 *
 * Decision order (first match wins — mirrors docs/product/MERGE_POLICY.md):
 *
 * 1. security / workflow / dependency / system_config → `hold`, regardless of
 *    validators, approval, or risk.  These lanes always need a human.
 * 2. Gemini FAIL → `no_pr`.  Failed work never becomes a PR.
 * 3. Tests red → `no_pr`.  Same rule: broken work never becomes a PR.
 * 4. Gemini inconclusive / not configured → `hold`.  No verdict means a human
 *    decides; the system never guesses an exit.
 * 5. High risk → `hold`.
 * 6. Eligibility: docs-only + low risk + Claude review approve, OR a code
 *    change with Claude review approve AND explicit operator approval.
 *    Eligible + `autoMergeEnabled=true` (a FUTURE cycle, after a written
 *    GR#10 change) → `auto_merge_eligible`; eligible but disabled (this
 *    cycle's only legal state) → `draft_pr_only` citing GR#10.
 * 7. Everything else that survived the gates → `draft_pr_only`.
 */
export function decideMergeAction(input: MergeActionInput): MergeActionDecision {
  const { changeKind, testsGreen, geminiVerdict, claudeReview, riskLevel, explicitApproval, autoMergeEnabled } = input

  // 1. Sensitive lanes hold regardless of everything else.
  if (SENSITIVE_KINDS.has(changeKind)) {
    return {
      action: 'hold',
      reason: `${changeKind} change always holds for human review, regardless of validators, risk, or approval`,
    }
  }

  // 2. Failed validator → no PR at all.
  if (geminiVerdict === 'fail') {
    return { action: 'no_pr', reason: 'Gemini validator failed the evidence — failed work never becomes a PR' }
  }

  // 3. Red tests → no PR at all.
  if (!testsGreen) {
    return { action: 'no_pr', reason: 'tests are red — broken work never becomes a PR' }
  }

  // 4. No usable validator verdict → a human decides.
  if (geminiVerdict === 'inconclusive' || geminiVerdict === 'not_configured') {
    return {
      action: 'hold',
      reason: `Gemini verdict is ${geminiVerdict} — hold for a human decision instead of guessing a machine exit`,
    }
  }

  // 5. High risk → a human decides.
  if (riskLevel === 'high') {
    return { action: 'hold', reason: 'high-risk change — hold for human review' }
  }

  // 6. Eligibility for (future-cycle) auto-merge.
  const reviewApproved = claudeReview === 'approve'
  const docsEligible = changeKind === 'docs_only' && riskLevel === 'low' && reviewApproved
  const codeEligible = changeKind === 'code' && reviewApproved && explicitApproval
  if (docsEligible || codeEligible) {
    if (!autoMergeEnabled) {
      return {
        action: 'draft_pr_only',
        reason: 'eligible on every gate, but auto-merge is DISABLED this cycle (WORKBOOK_v6 GR#10: human merge only) — the machine exit stops at a draft PR',
      }
    }
    return {
      action: 'auto_merge_eligible',
      reason: docsEligible
        ? 'docs-only low-risk change with green tests, Gemini PASS, and Claude review PASS'
        : 'code change with green gates and explicit operator approval',
    }
  }

  // 7. Survived the gates but not auto-merge eligible → draft PR for a human.
  if (!reviewApproved) {
    return {
      action: 'draft_pr_only',
      reason: claudeReview === 'rework'
        ? 'Claude review demands rework — draft PR only, for human triage'
        : 'no Claude review verdict recorded — draft PR only, a human reviews and merges',
    }
  }
  if (changeKind === 'code') {
    return { action: 'draft_pr_only', reason: 'code change without explicit operator approval — draft PR only, a human merges' }
  }
  return { action: 'draft_pr_only', reason: 'docs-only change above low risk — draft PR only, a human merges' }
}
