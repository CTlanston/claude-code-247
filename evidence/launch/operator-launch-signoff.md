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
- [x] Local operator approval action verified via `scripts/operator-l0-action-check.ts --auto`
- [x] Local operator HOLD resolution verified via `scripts/operator-l0-action-check.ts --auto`
- [x] Physical phone ntfy approval verified via browser action callback
- [x] Physical phone ntfy HOLD resolution verified via browser action callback
- [x] RoadmapAgent launchd job installed and run once successfully
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

## Operator approval verification

- Result: PASS for physical phone ntfy browser callback.
- Evidence:
  `evidence/launch/operator-phone-ntfy-reply-check-2026-05-27T21-38-02-925Z.json`
- Request emitted (UTC): 2026-05-27T21:38:02.926Z
- Decision received (UTC): 2026-05-27T21:38:14.392Z
- Approval id: `appr_mpol5g6m_shduw6`
- Result detail: the operator tapped the iOS ntfy `Send APPROVE`
  browser action; ntfy published the approval code back to the topic, and
  the TS approval path recorded an `approve` decision into
  `/Users/lanston/.claude-code-247/aedev-daemon/events`.

## Local operator approval fallback

- Result: PASS for local operator callback.
- Evidence:
  `evidence/launch/operator-l0-action-check-2026-05-27T20-49-34-659Z.json`
- Request emitted (UTC): 2026-05-27T20:49:34.659Z
- Decision received (UTC): 2026-05-27T20:49:34.808Z
- Approval id: `appr_mpojf45g_euh3ng`
- Result detail: approval decision `approve`, via `tailscale` transport
  interface, recorded into `/Users/lanston/.claude-code-247/aedev-daemon/events`.

## Operator HOLD resolution verification

- Result: PASS for physical phone ntfy browser callback.
- Evidence:
  `evidence/launch/operator-phone-ntfy-reply-check-2026-05-27T21-38-02-925Z.json`
- HOLD created (UTC): 2026-05-27T21:38:14.392Z
- HOLD resolved (UTC): 2026-05-27T21:38:25.412Z
- HOLD id: `evt_01KSNNZCQSR6VYH9X66VNCPQZP`
- Result detail: the operator tapped the iOS ntfy `Send RESOLVE`
  browser action; ntfy published the resolve code back to the topic, and
  `hold.policy.created` plus `hold.policy.resolved` were recorded into
  `/Users/lanston/.claude-code-247/aedev-daemon/events`.

## Local operator HOLD fallback

- Result: PASS for local operator callback.
- Evidence:
  `evidence/launch/operator-l0-action-check-2026-05-27T20-49-34-659Z.json`
- HOLD created (UTC): 2026-05-27T20:49:34.808Z
- HOLD resolved (UTC): 2026-05-27T20:49:34.949Z
- HOLD id: `evt_01KSNK69JRASH76RQ42TV9N8GN`
- Result detail: `hold.policy.created` and `hold.policy.resolved` were
  recorded into `/Users/lanston/.claude-code-247/aedev-daemon/events`, and
  the mirror was appended to `/Users/lanston/.claude-code-247/logs/holds.md`.

## RoadmapAgent cadence

- Result: PASS
- Installed launchd plist:
  `/Users/lanston/Library/LaunchAgents/com.claude247.roadmap-agent.plist`
- Repo template:
  `scripts/launchd/com.claude247.roadmap-agent.plist.tpl`
- `launchctl print gui/$(id -u)/com.claude247.roadmap-agent` reports
  `runs = 1`, `last exit code = 0`, `run interval = 3600 seconds`.
- Evidence:
  `evidence/launch/roadmap-agent-tick-2026-05-27T20-49-44-753Z.json`
- First launchd tick scanned 76 roadmap candidates and emitted 75
  proposals into `/Users/lanston/.claude-code-247/aedev-daemon/events`.

## What I will check tomorrow

- Confirm RoadmapAgent is either installed as a launchd job or explicitly
  documented as daemon-owned cadence.
- Start `evidence/launch/day-1.md` once real missions are running.
