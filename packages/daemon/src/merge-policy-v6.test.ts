/** Overnight P4 — full matrix tests for the v6 merge-action policy.
 *
 * The policy is a PURE DECISION FUNCTION (docs/product/MERGE_POLICY.md).
 * It is intentionally NOT wired into any merge execution path this cycle:
 * WORKBOOK_v6 GR#10 (human merge only) keeps auto-merge DISABLED, and the
 * exhaustive test below pins that `autoMergeEnabled=false` can NEVER yield
 * `auto_merge_eligible` — not even for a perfect docs-only change.
 */
import { describe, it, expect } from 'vitest'
import { decideMergeAction, type MergeActionInput } from './merge-policy-v6.js'

const CHANGE_KINDS = ['docs_only', 'code', 'security', 'workflow', 'dependency', 'system_config'] as const
const SENSITIVE_KINDS = ['security', 'workflow', 'dependency', 'system_config'] as const
const GEMINI_VERDICTS = ['pass', 'fail', 'inconclusive', 'not_configured'] as const
const CLAUDE_REVIEWS = ['approve', 'rework', 'none'] as const
const RISK_LEVELS = ['low', 'medium', 'high'] as const
const BOOLS = [true, false] as const

/** A docs-only change with every gate green — the strongest possible candidate. */
function perfectDocsOnly(overrides: Partial<MergeActionInput> = {}): MergeActionInput {
  return {
    changeKind: 'docs_only',
    testsGreen: true,
    geminiVerdict: 'pass',
    claudeReview: 'approve',
    riskLevel: 'low',
    explicitApproval: false,
    autoMergeEnabled: false,
    ...overrides,
  }
}

function* allInputs(fixed: Partial<MergeActionInput> = {}): Generator<MergeActionInput> {
  for (const changeKind of CHANGE_KINDS)
    for (const testsGreen of BOOLS)
      for (const geminiVerdict of GEMINI_VERDICTS)
        for (const claudeReview of CLAUDE_REVIEWS)
          for (const riskLevel of RISK_LEVELS)
            for (const explicitApproval of BOOLS)
              for (const autoMergeEnabled of BOOLS)
                yield { changeKind, testsGreen, geminiVerdict, claudeReview, riskLevel, explicitApproval, autoMergeEnabled, ...fixed }
}

describe('decideMergeAction — GR#10 default (auto-merge disabled this cycle)', () => {
  it('NEVER returns auto_merge_eligible when autoMergeEnabled=false — exhaustive over the whole matrix', () => {
    let combos = 0
    for (const input of allInputs({ autoMergeEnabled: false })) {
      combos += 1
      expect(decideMergeAction(input).action).not.toBe('auto_merge_eligible')
    }
    expect(combos).toBeGreaterThan(0)
  })

  it('a perfect docs-only change still stops at draft_pr_only, citing GR#10', () => {
    const decision = decideMergeAction(perfectDocsOnly())
    expect(decision.action).toBe('draft_pr_only')
    expect(decision.reason).toContain('GR#10')
  })
})

describe('decideMergeAction — validator and test gates', () => {
  it('gemini fail → no_pr (failed work never becomes a PR)', () => {
    for (const changeKind of ['docs_only', 'code'] as const) {
      const decision = decideMergeAction(perfectDocsOnly({ changeKind, geminiVerdict: 'fail' }))
      expect(decision.action).toBe('no_pr')
    }
  })

  it('red tests → no_pr (failing work never becomes a PR)', () => {
    for (const changeKind of ['docs_only', 'code'] as const) {
      const decision = decideMergeAction(perfectDocsOnly({ changeKind, testsGreen: false }))
      expect(decision.action).toBe('no_pr')
    }
  })

  it('gemini inconclusive → hold (a human decides, the system never guesses)', () => {
    for (const changeKind of ['docs_only', 'code'] as const) {
      expect(decideMergeAction(perfectDocsOnly({ changeKind, geminiVerdict: 'inconclusive' })).action).toBe('hold')
    }
  })

  it('gemini not_configured → hold (no validator evidence, no machine exit)', () => {
    for (const changeKind of ['docs_only', 'code'] as const) {
      expect(decideMergeAction(perfectDocsOnly({ changeKind, geminiVerdict: 'not_configured' })).action).toBe('hold')
    }
  })
})

describe('decideMergeAction — sensitive change kinds hold regardless', () => {
  it('security / workflow / dependency / system_config → hold for EVERY other combination', () => {
    for (const changeKind of SENSITIVE_KINDS) {
      for (const input of allInputs({ changeKind })) {
        const decision = decideMergeAction(input)
        expect(decision.action).toBe('hold')
        expect(decision.reason).toContain(changeKind)
      }
    }
  })
})

describe('decideMergeAction — future-cycle eligibility (autoMergeEnabled=true)', () => {
  it('perfect docs-only + enabled → auto_merge_eligible', () => {
    expect(decideMergeAction(perfectDocsOnly({ autoMergeEnabled: true })).action).toBe('auto_merge_eligible')
  })

  it('code with all gates green but NO explicit approval → draft_pr_only', () => {
    const decision = decideMergeAction(perfectDocsOnly({ changeKind: 'code', autoMergeEnabled: true }))
    expect(decision.action).toBe('draft_pr_only')
  })

  it('code with explicit approval + all gates green + enabled → auto_merge_eligible', () => {
    const decision = decideMergeAction(perfectDocsOnly({ changeKind: 'code', explicitApproval: true, autoMergeEnabled: true }))
    expect(decision.action).toBe('auto_merge_eligible')
  })

  it('docs-only above low risk is never auto-merge eligible: medium → draft_pr_only, high → hold', () => {
    expect(decideMergeAction(perfectDocsOnly({ riskLevel: 'medium', autoMergeEnabled: true })).action).toBe('draft_pr_only')
    expect(decideMergeAction(perfectDocsOnly({ riskLevel: 'high', autoMergeEnabled: true })).action).toBe('hold')
  })

  it('claude review rework or none → draft_pr_only even with everything else green', () => {
    for (const claudeReview of ['rework', 'none'] as const) {
      expect(decideMergeAction(perfectDocsOnly({ claudeReview, autoMergeEnabled: true })).action).toBe('draft_pr_only')
    }
  })
})

describe('decideMergeAction — output contract', () => {
  it('every decision in the full matrix carries a non-empty reason', () => {
    for (const input of allInputs()) {
      const decision = decideMergeAction(input)
      expect(decision.reason.length).toBeGreaterThan(0)
      expect(CLAUDE_REVIEWS.length).toBeGreaterThan(0) // matrix sanity
    }
  })

  it('high risk that survives the validator gates → hold (never a silent draft PR)', () => {
    const decision = decideMergeAction(perfectDocsOnly({ changeKind: 'code', riskLevel: 'high', explicitApproval: true, autoMergeEnabled: true }))
    expect(decision.action).toBe('hold')
  })
})
