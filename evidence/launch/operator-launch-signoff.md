# L0 Operator Launch Sign-off

> Prepared by Codex after the latest launch-smoke run. This is not a
> Lanston signature; Lanston must review, confirm the phone/operator-only
> actions, and sign before treating L0 L3 as complete.

- Operator: Lanston (ctlanston@gmail.com)
- Date (UTC): 2026-05-27T20:34:09Z
- Smoke artifact: evidence/launch/smoke-2026-05-27T20-33-55-220Z.json
- Commit SHA on `main` at launch smoke: f86531d
- Prepared by: Codex

## Acceptance (copy-paste from ADR-0015)

> I, Lanston, have read NEXT_PLAN_WORKBOOK.md §2 "The Trade-Off"
> and accept the four risk acknowledgements:
>
> 1. Rare failure modes may surface in flight; recovery is my responsibility.
> 2. Cellular alerting and 3am responsiveness are not pre-validated.
> 3. A runaway billing scenario could still happen on day 1.
> 4. Production data is the soak data; there is no staging equivalent.
>
> I authorize launch-fast mode for v2.2.x post-GA operations.
> If at any point the trade-offs prove wrong, I will revert to the
> NEXT-1.0 12-week soak-first plan (in git history).

## Signature

Prepared by Codex; Lanston signature required.

## What I just did (record of action)

- [x] `mesh_enabled: true` observed in `/Users/lanston/.claude-code-247/config.yaml`
- [x] launch-smoke executed on `main` commit f86531d and wrote the smoke artifact above
- [ ] Lanston confirmed real phone/Tailscale + ntfy approval tap
- [ ] Lanston confirmed HOLD resolution from phone
- [ ] RoadmapAgent launchd job started
- [ ] cost_per_pr_usd_7d gauge < $1 (baseline, no missions yet)
- [ ] Alert routes synthetic-tripped today within 60s (per L2.2)

## Notes

The current `scripts/launch-smoke.ts` CLI labels the run as `mode: real`,
but still binds the seven checks to `syntheticChecks()`. Therefore this
artifact proves the smoke harness path and report generation on the
operator host, but it does not prove the real phone tap, real HOLD
resolution, RoadmapAgent launchd cadence, or real telemetry event slice.

Codex fixed the harness timer cleanup first so the smoke command exits
normally after producing evidence.

## What I will check tomorrow

- Confirm RoadmapAgent is either installed as a launchd job or explicitly
  documented as daemon-owned cadence.
- Record the first true phone approval + HOLD resolution with timestamps.
- Start `evidence/launch/day-1.md` once real missions are running.
