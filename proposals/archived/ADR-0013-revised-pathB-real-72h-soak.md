# ADR-0013-revised (Path B): real 72h soak earns v2.2.0 GA

> **DRAFT — operator must run the soak AND sign the §Acceptance block below before this replaces the current ADR-0013.**
> Authority: CC_RESTORE_SPEC §3 T5 path-B option.
> Companion: `proposals/ADR-0013-revised-pathA-rc-grade.md` is the alternative.

---

**Status:** PROPOSED (Path B — earn the GA tag with real 72h evidence)
**Date:** _<fill on completion>_
**Supersedes:** ADR-0013 (the original "v2.2.0 Real-Clock 30min Soak" record, which
was accepted on synthetic compressed-1-day data — see CC_RESTORE_SPEC §2 audit row 5)

## Context

Same as Path A: ADR-0013's 30-min real-clock soak standard was a launch-fast
compression; the workbook's original requirement was 72h. Path B does the 72h
soak for real and earns the `v2.2.0` GA tag honestly.

This path costs ~76 hours wall-clock (72h soak + ~4h of work). It is the right
path if:
- the operator wants the GA tag to mean what the industry expects;
- the operator has a Mac that can run unattended for 3 days;
- the operator has time to do red-team round-3 checkpoints at 24h / 48h / 72h.

## Decision (provisional — fills on completion)

1. **Run scripts/soak-k2-full.ts** with `--duration=72h --redteam-checkpoints=24,48,72`
   between `<start UTC>` and `<end UTC>` (must be ≥ 72h apart).
2. **Verify all 5 K2 prerequisites:**
   1. 72h wall-clock with `mesh.enabled: true` for ≥ 99% of the window
   2. Red-team round-3 (Stage L 30 prompts mesh-on) passes at t+24, t+48, t+72
   3. `mesh.enabled` flipped to `false` for ≥ 1h late in the window;
      v2.1 fallback proves clean (no errors, no missed events)
   4. Operator signs `evidence/stage-K2/L3-validate/operator-signoff.md`
      noting agent-tree dashboard observed under sustained load
   5. This ADR records the run (you are reading the record)
3. **Update `evidence/stage-K2/METADATA.yaml`:**
   ```
   l1_status: passed
   l2_status: passed
   l3_status: passed
   ```
4. **Update tag annotation:**
   ```
   git tag -d v2.2.0
   git tag -a v2.2.0 -m "v2.2.0 — see ADR-0013-revised (Path B). 72h soak: <start UTC> → <end UTC>."
   git push --force origin v2.2.0  # GR7-class; requires operator-typed approval
   ```

## Soak timing fields (operator fills in)

| Field | Value |
|---|---|
| Soak start (UTC) | _<fill>_ |
| Soak end (UTC) | _<fill>_ |
| Duration (hours) | _<must be ≥ 72>_ |
| Daemon restarts during window | _<count>_ |
| Daemon uptime pct | _<calc>_ |
| Total cost (USD) | _<from cost-meter>_ |
| cost_per_pr_usd_7d at window end | _<from cost-meter>_ |
| Red-team round-3 t+24 verdict | _PASS / FAIL_ |
| Red-team round-3 t+48 verdict | _PASS / FAIL_ |
| Red-team round-3 t+72 verdict | _PASS / FAIL_ |
| mesh.enabled=false flip-back window | _<UTC start> → <UTC end>_ |
| Flip-back clean? | _Y / N + note_ |

## Threshold readouts (must all PASS)

| Metric | Threshold | Observed |
|---|---|---|
| `daemon_uptime_pct_7d` | ≥ 99.0% | _<fill>_ |
| `autonomous_pr_success_rate_7d` | ≥ 0.5 | _<fill>_ |
| `cost_per_autonomous_pr_usd_7d` | ≤ 8 (cap 15) | _<fill>_ |
| `sentinel_false_block_rate_7d` | ≤ 0.05 | _<fill>_ |
| `hold_mttr_p95_min_7d` | ≤ 30 | _<fill>_ |
| All 3 red-team checkpoints | PASS | _<fill>_ |
| Flip-back | clean | _<fill>_ |

## Acceptance — operator signature

> I, lanston (ctlanston@gmail.com), ran the 72h soak described above and
> confirm every threshold readout in the table is accurate. I authorize
> the `v2.2.0` tag to remain on the GA commit pointed to by this ADR.
>
> Signature:
> Date (UTC):

## Consequences

**Positive**
- `v2.2.0` is a real GA tag with real evidence.
- The repo's claims match reality without any rc-grade indirection.

**Negative**
- 72h wall-clock cost is real. If the operator's Mac is busy with other
  work, this blocks for 3 days.
- A failure mid-soak forces a restart from t=0; partial credit doesn't apply.

## What this ADR does NOT do

- It does NOT lock the workbook into 72h-soak forever — future minor versions
  can use a shorter soak via their own ADR.
- It does NOT retroactively close any earlier honesty-flag.

## Closes honesty flag

`k2_synthetic_one_day_only` → `false` (real 72h soak ran).
