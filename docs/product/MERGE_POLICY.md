# Merge Policy — v6 mature-product action matrix

> **Status (this cycle):** policy shipped as a **PURE DECISION FUNCTION +
> tests only**. No merge automation is wired. **Auto-merge is DISABLED per
> [WORKBOOK_v6 GR#10](../../WORKBOOK_v6.md) (human merge only):** the system
> never merges; a draft PR is the terminal machine exit, and the merge button
> belongs to a human. Enabling auto-merge in any future cycle requires a
> written operator-approved change to WORKBOOK_v6 §2.

## Where this lives

- **This document** is the forward-looking, mature-product action matrix.
- **Implementation:** `decideMergeAction()` in
  [`packages/daemon/src/merge-policy-v6.ts`](../../packages/daemon/src/merge-policy-v6.ts)
  — pure, exported only, **not imported by any merge execution path**.
- **Tests:** `packages/daemon/src/merge-policy-v6.test.ts` — full matrix,
  including an exhaustive proof that `autoMergeEnabled=false` (the GR#10
  default, and the only legal value this cycle) can never produce
  `auto_merge_eligible`, even for a perfect docs-only change.

## Relationship to docs/AUTO_MERGE_POLICY.md (reconciliation, not duplication)

[`docs/AUTO_MERGE_POLICY.md`](../AUTO_MERGE_POLICY.md) describes the legacy
v2.x **risk-score** policy implemented by the `MergePolicy` class
(`packages/validators/src/merge-policy.ts`), which mission-runner step 7 still
uses to label a run `AUTO_MERGE` / `WAITING` / `BLOCKED`. Two clarifications:

1. Under GR#10 the runtime meaning of that `AUTO_MERGE` label is **"open a
   draft PR through the fail-closed `DraftPrGate`"** — never an actual merge.
   The gate additionally fail-closes on `allow_remote_writes`, the per-repo
   whitelist, `repo.enabled`, and forbidden paths.
2. This document layers the v6 **action vocabulary**
   (`auto_merge_eligible` / `draft_pr_only` / `hold` / `no_pr`) on top, keyed
   by change kind rather than only by score. The legacy doc remains valid for
   risk scoring; where the two disagree on the final action, **GR#10 and this
   matrix win** (e.g. the legacy "AUTO_MERGE eligible if all gates pass" row
   is capped at a draft PR this cycle).

## Action matrix

| Situation | Action |
|---|---|
| security / workflow / dependency / system-config change — any other state | `hold` |
| Gemini validator **FAIL** | `no_pr` (failed work never becomes a PR) |
| tests red | `no_pr` (same rule as a failed validator) |
| Gemini **inconclusive** or **not configured** | `hold` (a human decides; the system never guesses) |
| risk **high** (after the gates above) | `hold` |
| **docs-only** + low risk + tests pass + Gemini PASS + Claude review PASS | eligible for auto-merge **in a future cycle — currently DISABLED per WORKBOOK_v6 GR#10**, so this cycle: `draft_pr_only` |
| **code** change + all gates green + **explicit operator approval** | same as above: eligible only in a future cycle; this cycle `draft_pr_only` |
| **code** change without explicit approval (gates green) | `draft_pr_only` |
| Claude review `rework` / no review verdict (gates green) | `draft_pr_only` |
| docs-only above low risk (gates green) | `draft_pr_only` |

## Decision order (mirrors the implementation)

1. `security` / `workflow` / `dependency` / `system_config` → **hold**,
   regardless of validators, risk, tests, or approval.
2. Gemini `fail` → **no_pr**.
3. Tests red → **no_pr**.
4. Gemini `inconclusive` / `not_configured` → **hold**.
5. Risk `high` → **hold**.
6. Eligibility check: docs-only + low risk + Claude review `approve`, **or**
   code + Claude review `approve` + explicit operator approval.
   - eligible + `autoMergeEnabled=true` (future cycle only) → **auto_merge_eligible**
   - eligible + `autoMergeEnabled=false` (this cycle, always) → **draft_pr_only**, citing GR#10
7. Everything else that survived the gates → **draft_pr_only**.

## Scope guarantee for this cycle

- `decideMergeAction()` is **export-only**: nothing in the daemon, runner, or
  GitHub planes calls it to execute a merge.
- All production-relevant call sites (there are none yet) must pass
  `autoMergeEnabled: false` until WORKBOOK_v6 GR#10 is formally amended.
- `auto_merge_eligible` is therefore a **label for audit/forecast purposes**,
  unreachable this cycle; the tests pin this property exhaustively.
