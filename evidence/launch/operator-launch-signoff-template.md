# L0 Operator Launch Sign-off

> Sign this AFTER 7/7 smoke pass, BEFORE flipping `mesh.enabled=true`
> on a non-test config. Per NEXT_PLAN_WORKBOOK §3 Phase L0 L3 +
> ADR-0015 §"Operator acceptance statement".

- Operator: <name + email>
- Date (UTC): <YYYY-MM-DDTHH:MM:SSZ>
- Smoke artifact: evidence/launch/smoke-<UTC>.json (7/7 LAUNCH_AUTHORIZED)
- Commit SHA on `main` at launch: <sha>

## Acceptance (copy-paste from ADR-0015)

> I, <operator>, have read NEXT_PLAN_WORKBOOK.md §2 "The Trade-Off"
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

<name>, <UTC>

## What I just did (record of action)

- [ ] mesh.enabled flipped to `true` in config.yaml
- [ ] RoadmapAgent launchd job started
- [ ] Phone confirmed on Tailscale + ntfy receiving test ping
- [ ] cost_per_pr_usd_7d gauge < $1 (baseline, no missions yet)
- [ ] Alert routes synthetic-tripped today within 60s (per L2.2)

## What I will check tomorrow

(short list — your operator concerns at this moment in time)
