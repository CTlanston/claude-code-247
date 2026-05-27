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

Lanston, 2026-05-27T  01:39

## What I just did (record of action)

- [x] `mesh_enabled: true` observed in `/Users/lanston/.claude-code-247/config.yaml`
- [x] launch-smoke executed on `main` commit f86531d and wrote the smoke artifact above
- [ ] Lanston confirmed real phone/Tailscale + ntfy approval tap — BLOCKED; no live pending approval entrypoint found
- [ ] Lanston confirmed HOLD resolution from phone — BLOCKED; no live pending HOLD entrypoint found
- [ ] RoadmapAgent launchd job started — BLOCKED/NEEDS DECISION; no standalone launchd job found
- [ ] cost_per_pr_usd_7d gauge < $1 (baseline, no missions yet) — NOT MEASURED
- [ ] Alert routes synthetic-tripped today within 60s (per L2.2) — NOT RUN

## Notes

The current `scripts/launch-smoke.ts` CLI labels the run as `mode: real`,
but still binds the seven checks to `syntheticChecks()`. Therefore this
artifact proves the smoke harness path and report generation on the
operator host, but it does not prove the real phone tap, real HOLD
resolution, RoadmapAgent launchd cadence, or real telemetry event slice.

Codex fixed the harness timer cleanup first so the smoke command exits
normally after producing evidence.

## Local host checks performed by Codex

- Daemon status: `curl -sf http://127.0.0.1:7247/status` returned
  `{"status":"running","version":"0.0.1",...}` at 2026-05-27T20:40Z.
- Daemon queues: `/approvals`, `/missions`, `/tasks`, and `/repos` all
  returned empty arrays at 2026-05-27T20:41Z.
- launchd: `com.claude247.daemon` is loaded and running.
- launchd: no `roadmap` or `roadmap-agent` job appears in
  `launchctl list`.
- Config: `/Users/lanston/.claude-code-247/config.yaml` contains
  `mesh_enabled: true`.
- Legacy phone/dashboard path is not currently healthy:
  - `com.claude247.orchestrator` and `com.claude247.dispatcher` logs show
    `.venv/bin/claude247` failing with `ModuleNotFoundError: gateway`.
  - Legacy dashboard `/status-board.json` returns HTTP 500 with
    `sqlite3.OperationalError: unable to open database file`.

## Real phone approval verification

- Result: BLOCKED
- Reason: no live pending approval exists in the TS daemon (`/approvals`
  returned `[]`), and the legacy `claude247 approve-merge` phone path is
  currently broken after the Python cutover (`ModuleNotFoundError:
  gateway` in launchd logs).
- Required operator follow-up: use or build a healthy real approval
  entrypoint, then record request emitted UTC, phone received UTC,
  approve tapped UTC, decision received UTC, and event id.

## Real phone HOLD resolution verification

- Result: BLOCKED
- Reason: no live pending HOLD exists in the TS daemon, and no safe current
  dashboard/CLI endpoint was found for creating a HOLD that can be
  resolved from phone.
- Required operator follow-up: create a safe real HOLD injection or wait
  for the next genuine HOLD, resolve from phone, then record created UTC,
  notification received UTC, resolved UTC, and event id.

## RoadmapAgent cadence

- Result: NEEDS DECISION
- `launchctl list | grep -E "claude247|roadmap"` showed daemon,
  rollback-drill, orchestrator, backup, dispatcher, and dashboard jobs,
  but no standalone RoadmapAgent job.
- Repo search found RoadmapAgent package/tests and soak harness usage, but
  no dedicated launchd plist.
- Decision needed: either document RoadmapAgent cadence as daemon-owned, or
  add/install a dedicated RoadmapAgent launchd job before claiming this
  L0 checklist item complete.

## What I will check tomorrow

- Confirm RoadmapAgent is either installed as a launchd job or explicitly
  documented as daemon-owned cadence.
- Record the first true phone approval + HOLD resolution with timestamps.
- Start `evidence/launch/day-1.md` once real missions are running.
