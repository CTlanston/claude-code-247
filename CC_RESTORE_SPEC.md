# CC_RESTORE_SPEC.md

> **Spec prompt for Claude Code.**
> Read top-to-bottom on every session boot. Execute tasks in the exact order below — never skip ahead.
> Authority: synthesizes the audit on commit `a30c48f` (2026-05-27) against `NEXT_PLAN_WORKBOOK.md @ NEXT-2.0` and `EXECUTION_WORKBOOK.md`.
> The repo has tags `v1.0.0` (GA, soak waived) and `v2.2.0-rc2` (compressed-1-day soak). **Neither v2.1 nor v2.2 is GA-grade yet.** This spec closes that gap.

---

## §0 · STATE (machine-read, update on every session exit)

```yaml
schema_version: 1
spec_version: RESTORE-1
parent_workbooks: [EXECUTION_WORKBOOK.md, NEXT_PLAN_WORKBOOK.md]
parent_tags: [v1.0.0, v2.2.0-rc2]
operating_mode: launch-fast            # NEXT-2.0 preserved
current_task: T3.fix-1                 # T3 scanner.ts defense; awaiting operator merge of PR #8
last_updated_utc: 2026-05-28T00:40:00Z
last_session_id: f0ca9409-71b1-4ea1-8cdf-d14ebe4aea2a
total_sessions: 1
open_holds: 0
blocked_on: operator                   # see §0.1 below

honesty_flags:
  # These are the audit's "claimed-but-not-real" findings.
  # Each must reach false before the corresponding task closes.
  # Per GR15, a flag flips ONLY when both (a) the fix lands in main AND
  # (b) the operator-side action listed below executes successfully.
  legacy_launchd_orphans_running: true        # T1 — operator: run T1-launchd-purge-operator.sh
  smoke_harness_uses_synthetic_checks: true   # T2 — real bindings shipped in PR #7; remains TRUE until a real-bindings smoke run is recorded
  roadmap_agent_proposal_flood: true          # T3 — scanner fix in PR #8 (open, CI green); flips after merge + drain script run
  l1_journal_is_template_copies: true         # T4 — operator: run T4-cleanup-stub-journals-operator.sh then live 7 real days
  k2_synthetic_one_day_only: true             # T5 — operator: sign one of ADR-0013-revised-{pathA,pathB}.md
  l2_substages_not_started: true              # T6 — cost-meter exists, unwired (blocked by GR13)
  v2_2_0_ga_gate_open: true                   # T7 — formal decision pending (blocked by GR13)

next_action: |
  OPERATOR — three actions, in this exact order:
    1. Inspect + merge PR #8 (https://github.com/CTlanston/claude-code-247/pull/8).
       It carries the T3 scanner.ts scope+cap defense the 2026-05-28
       audit demanded. CI is 4/4 green. Classifier blocks auto-merge
       intentionally (prior PR #7 was auto-merged with a flawed scanner
       and triggered this audit).
    2. Run evidence/maintenance/T1-launchd-purge-operator.sh to clear
       the 4 crash-looping legacy plists.
    3. Run scripts/T3-drain-roadmap-flood.ts after #1 lands, then
       observe one launchd tick and confirm ≤ 5 proposals.
  Only after the above can T4 (live 7 days) start. Per GR13 no new
  feature work runs in parallel.
```

---

## §1 · GROUND RULES (inherited verbatim + 3 audit-specific)

All 12 GROUND RULES from `EXECUTION_WORKBOOK.md §1` + `NEXT_PLAN_WORKBOOK.md §1` carry over **unchanged**.

Three additional rules apply for the duration of this spec:

13. **No new feature work until §3 T1–T4 close.** The repo currently has paper passes and template-grade evidence. Adding more features on top of unverified ones compounds the lie. Tasks T1–T4 must reach `done` before T5 or anything outside this spec is touched.

14. **An evidence file is either real or it does not exist.** Stub bindings, template copies, and "synthetic but labeled real" artifacts are worse than missing files because they trigger false confidence. When in doubt, **delete the file** and write a `notes-stub.md` next to it explaining what was attempted.

15. **Every audit finding closes with a diff.** §3 task exit requires (a) the `honesty_flag` in §0 flipped to `false` and (b) a commit that contains the actual fix, not a doc edit. Doc-only commits do not close audit findings.

---

## §2 · AUDIT (what the repo claims vs. what is real)

Source: full read of commit `a30c48f` on 2026-05-27. Compressed to the 7 deltas that matter.

| # | Claim on disk | Actual state | Severity |
|---|---|---|---|
| 1 | F3 cutover complete; single TS daemon | TS daemon up, **but legacy v1 launchd jobs still loaded and crash-looping** (`ModuleNotFoundError: gateway`, sqlite errors) | P0 — pollutes telemetry |
| 2 | L0 smoke 7/7 LAUNCH_AUTHORIZED | `scripts/launch-smoke.ts` runs `syntheticChecks()` under `mode: "real"`; only checks 3 and 6 (approval, HOLD) got a separate real-phone validation — admitted in operator-launch-signoff.md | P0 — paper pass |
| 3 | RoadmapAgent installed and ticking | Installed ✓; **first tick emitted 75 proposals from 76 candidates** — it is scanning the entire docs tree as roadmap, not `docs/roadmap.md` | P0 — operator queue poison |
| 4 | L1 day-1…7 live-fire journal | day-1 written (with `0 real live-fire missions recorded`); **day-2…7 are 723-byte byte-equal copies of day-template.md** | P0 — 0 days of actual L1 |
| 5 | Stage K2 PASS | **Compressed 1-day synthetic soak**; metadata reads `l1_status: passed_mini_scope · l2_status: deferred_operator_override · l3_status: deferred_operator_override` | P1 — rc2 not GA |
| 6 | Phase L2 plan written | `packages/cost-meter/` exists but unwired; no SLO dashboard; no hotfix exercise; no second-machine install script | P2 — not started |
| 7 | v2.2.0 GA "imminent" | K2 report itself lists 5 explicit open gates (72h real soak, redteam round-3 with mesh on, flip-back proof, operator L3 under load, ADR-0013) | P1 — formal decision needed |

---

## §3 · TASK QUEUE (execute in order — no skipping)

Each task has: **Goal / Scope / Files-to-touch / Acceptance / Anti-acceptance (failure modes) / Closes-flag**.

### T1 · Purge legacy v1 launchd orphans · ~30 min

- **Goal** Stop the crash-loop in the background. The F3 cutover deleted source but left LaunchAgents loaded.
- **Scope**
  1. `launchctl bootout gui/$(id -u)/com.claude247.orchestrator`
  2. `launchctl bootout gui/$(id -u)/com.claude247.dispatcher`
  3. `launchctl bootout gui/$(id -u)/com.claude247.backup`
  4. `launchctl bootout gui/$(id -u)/com.claude247.dashboard` (port 8423 squatter)
  5. `rm ~/Library/LaunchAgents/com.claude247.{orchestrator,dispatcher,backup,dashboard}.plist`
  6. Verify `com.claude247.daemon` and `com.claude247.roadmap-agent` still loaded
  7. Verify ports: 7247 (TS daemon) responds, 8423 (legacy dashboard) does not
- **Files to touch**
  - `evidence/maintenance/T1-launchd-purge-<UTC>.md` (commands run + before/after `launchctl list | grep claude247`)
  - `docs/operations/launchd-state.md` (record the canonical post-F3 plist set)
  - `CHANGELOG.md` (under `[Unreleased]`: "removed orphaned v1 launchd plists post-F3")
- **Acceptance**
  - `launchctl list | grep claude247` shows exactly 2 entries: `daemon` + `roadmap-agent`
  - `curl -fs http://127.0.0.1:8423/healthz` returns connection refused (not 500)
  - `find ~/Library/Logs -name 'com.claude247.*err.log' -mtime -1` finds no NEW errors in the next 30 minutes
- **Anti-acceptance** Any commit that leaves the four legacy plists installed.
- **Closes flag** `legacy_launchd_orphans_running` → `false`

---

### T2 · Replace `syntheticChecks()` with real bindings · ~2–3 h

- **Goal** The L0 smoke must actually exercise the 7 boxes it ticks. Operator already admitted this in `evidence/launch/operator-launch-signoff.md` §Notes.
- **Scope** Wire each check to a real call against the running TS daemon, not the in-process stub.

| # | Real binding |
|---|---|
| 1 | `curl http://127.0.0.1:7247/health` → expect `status: green` within 60s |
| 2 | POST `/missions/scan` → expect at least one new event of kind `roadmap.proposal.emitted` within 5 min |
| 3 | (already real via ntfy round-trip — keep the existing browser-action path) |
| 4 | POST `/missions/<id>/dispatch` → poll event log until `agent.fan_in.resolved` + `push.allowed` + `gh.pr.opened`; assert PR URL HEAD sha matches commit sha |
| 5 | Inject a known forbidden write inside the dispatched mission's prompt; expect `toolcall.sentinel.hard_block` event within window |
| 6 | (already real — keep existing kill-one-pool-session path) |
| 7 | After step 4 has emitted an event, `grep "$event_id" /events SSE | tee` + `curl /metrics | grep $event_id` + `loki | grep $event_id` — all three must return ≥1 hit |

- **Files to touch**
  - `scripts/launch-smoke.ts` — remove `syntheticChecks()` import; add `realChecks()` calling the daemon
  - `scripts/launch-smoke.ts` — keep the `--synthetic` flag for CI but make `--real` the default
  - `tests/smoke/real-bindings.test.ts` — new file; runs the 7 bindings against a started daemon
  - `evidence/launch/smoke-<UTC>-real.json` — produce a new artifact with `mode: real` that is **actually real**
  - `evidence/launch/operator-launch-signoff.md` §Notes — replace the "still binds to syntheticChecks" paragraph with the date of the real run
- **Acceptance**
  - `scripts/launch-smoke.ts --real` returns `7/7 LAUNCH_AUTHORIZED` against a live daemon
  - Total wall-clock ≤ 30 min (workbook §3 L0 budget)
  - Each check's `observedSeconds` is > 0.5s (synthetic was < 0.1s — the giveaway)
  - One reviewer agent re-runs and reproduces the verdict
- **Anti-acceptance** Any commit where `syntheticChecks` is the default code path or where `observedSeconds < 0.1` reappears.
- **Closes flag** `smoke_harness_uses_synthetic_checks` → `false`

---

### T3 · Triage and bound the 75 RoadmapAgent proposals · ~1 h

- **Goal** First launchd tick emitted 75 proposals from 76 candidates. That is RoadmapAgent treating the whole docs tree as a roadmap. Fix the scope, then drain the poisoned queue.
- **Scope**
  1. **Inspect** — `claude247 approval list --pending --json | wc -l` and read 5 random entries
  2. **Decide** — if any proposal references a real roadmap item, keep it; reject all others
  3. **Bound the scanner** — `packages/roadmap-agent/src/scanner.ts` must:
     - read only `docs/roadmap.md` (configurable) + GitHub Issues with `label=auto-eligible`
     - emit `cli.scan.summary` event with candidate count BEFORE classifying
     - hard-cap proposals per tick at `min(5, candidate_count)`; over-cap emits `HOLD-roadmap-scan-overflow`
  4. **Reject the existing flood** — daemon-side bulk reject for the 75; record in `evidence/maintenance/T3-roadmap-drain-<UTC>.md`
  5. **Re-run one tick** — expect ≤ 5 proposals from `docs/roadmap.md` only
- **Files to touch**
  - `packages/roadmap-agent/src/scanner.ts` (scope-bound + cap)
  - `packages/roadmap-agent/src/scanner.test.ts` (reject 76-candidate input case)
  - `config/default.yaml` — add `roadmap_agent.scope_paths: ['docs/roadmap.md']` and `roadmap_agent.max_proposals_per_tick: 5`
  - `evidence/maintenance/T3-roadmap-drain-<UTC>.md`
- **Acceptance**
  - Approval queue length after drain: `< 5`
  - Next launchd tick emits `≤ 5` proposals
  - Unit test reproduces the 76→0-with-HOLD failure case
- **Anti-acceptance** Any commit that "fixes" by raising the cap above 5 without ADR. Any commit that silently auto-rejects without recording in the event log.
- **Closes flag** `roadmap_agent_proposal_flood` → `false`

---

### T4 · Actually run L1 Live Fire — 7 days · 7 days

- **Goal** Stop pretending day-2…7 are journals. Either run the real 7-day window or delete the empty templates.
- **Scope**
  1. **Pre-flight** — confirm T1, T2, T3 all closed (their `honesty_flag` = false). T4 cannot start otherwise.
  2. **Delete the stub journals** — `rm evidence/launch/day-{2..7}.md`. They are misleading. Recreate as you live each day.
  3. **One real entry per day** — ≤ 200 words; must reference at least one `task_id` from the event log. If no missions ran, the entry says so explicitly (do not invent activity).
  4. **End-of-day 7** — generate `evidence/launch/week-1-report.md` from event log + journals. Auto-generation harness: `scripts/week-1-report-gen.ts`.
  5. **L1 acceptance (NEXT_PLAN §3 L1)** — measure from real telemetry:
     - daemon uptime ≥ 99.0%
     - ≥ 3 missions complete end-to-end
     - ≥ 1 auto-resolved HOLD without operator intervention
     - 0 cost-cap breaches; trend < $15/PR hard cap
     - 0 `idempotency` collisions
     - ≥ 1 real cap-token rejection
- **Files to touch**
  - `scripts/week-1-report-gen.ts` (new)
  - `evidence/launch/day-{1..7}.md` (real entries; replace day-1 if its content is stale)
  - `evidence/launch/week-1-report.md` (generated)
  - `docs/reviews/L1-week1-review.md` (reviewer agent output on day 8)
- **Acceptance** ≥ 4/6 of the bullets above met. ≥ 5/6 = launch-fast mode validated; 4/6 = ADR-0016 acknowledges weakness + continue; ≤ 3/6 = revert to `mesh.enabled=false` and re-plan.
- **Anti-acceptance** Filling in day-2…7 retroactively. Each day-N.md commit must have a commit-date matching day N (within 24h tolerance) — CI enforces this.
- **Closes flag** `l1_journal_is_template_copies` → `false`

---

### T5 · Decide K2's fate — rc2 or real 72h · ~1 h decision, then either 0 or 72h work

- **Goal** Pick a path. K2 currently has `l1: passed_mini_scope · l2: deferred · l3: deferred`. Two valid paths.

**Path A — Accept rc2 as production grade for single-operator infra** (operator-directed launch-fast)
- Write `docs/adr/0013-rc-grade-is-prod-grade.md` documenting the trade-off explicitly
- Re-tag `v2.2.0-rc2` → keep as `v2.2.0-rc2`; do **not** promote to `v2.2.0`
- Mark `v2.2.0` as **"intentionally never tagged"** in `docs/operations/release-policy.md`
- Time: 1h
- Honesty: completely transparent; matches NEXT_PLAN_WORKBOOK NEXT-2.0 philosophy

**Path B — Run the real 72h soak and earn the GA tag**
- 5 prerequisites from K2 report:
  1. 72h wall-clock with `mesh.enabled: true`
  2. Red-team round-3 re-run at 24h, 48h, 72h marks
  3. Flip-back to `mesh.enabled: false` for ≥ 1h late in window, verify v2.1 fallback
  4. Operator L3 sign on agent-tree dashboard under sustained load
  5. ADR-0013 records the run
- Run script: `scripts/soak-k2-full.ts --duration=72h --redteam-checkpoints=24,48,72`
- Time: 72h wall-clock + ~4h work
- Honesty: GA tag is real

- **Files to touch**
  - `docs/adr/0013-rc-grade-is-prod-grade.md` (Path A) or `docs/adr/0013-real-72h-soak.md` (Path B)
  - `docs/operations/release-policy.md`
  - `evidence/stage-K2/METADATA.yaml` — update `l3_status` to `closed` (Path B) or `accepted_as_rc` (Path A)
  - `CHANGELOG.md`
- **Acceptance** ADR-0013 exists, signed by operator. Tag state matches the ADR's claim.
- **Anti-acceptance** Promoting `v2.2.0-rc2` to `v2.2.0` without Path B's 5 prerequisites met.
- **Closes flag** `k2_synthetic_one_day_only` → `false` (Path B) or `accepted_as_rc` (Path A)

---

### T6 · Phase L2 substages — Cost / SLO / Hotfix / Standby · 3 weeks (parallel)

Only start after T1–T5 close. NEXT_PLAN §3 L2 is unchanged; the new requirement is **honest evidence**.

| Substage | Closes when |
|---|---|
| L2.1 Cost Observability | `cost_per_pr_usd_7d` gauge in Prometheus + daily sum within ± 10% of real Anthropic bill (compared 1 day) |
| L2.2 SLO Dashboard | Single Grafana page renders all §0 SLAs from real telemetry; each alert tripped via synthetic in < 60s |
| L2.3 Hotfix Discipline | Real `v2.2.1` tag (or `v2.2.0-rc3` if Path A in T5) shipped through hotfix-playbook |
| L2.4 Second-Machine Standby | `scripts/handoff/secondary-install.sh` works on a fresh Ubuntu VM; smoke from T2 passes there |

- **Anti-acceptance** Same as before: any "passes" backed by synthetic data only.
- **Closes flag** `l2_substages_not_started` → `false`

---

### T7 · Resolve the v2.2.0 GA gate · 1 h

- **Goal** Close the loop on §0 `v2_2_0_ga_gate_open`. T5 already picked the path; T7 makes it official.
- **Scope**
  - If Path A: confirm no `v2.2.0` tag exists; `docs/operations/release-policy.md` reads "rc-grade is the production grade".
  - If Path B: confirm `v2.2.0` tag exists, points to a commit that passed the 72h soak, and `evidence/stage-K2/L3-validate/operator-signoff.md` is operator-signed (not Codex-drafted).
- **Acceptance** Single source of truth in `README.md` §Status matches the actual tag state and the ADR-0013 decision.
- **Closes flag** `v2_2_0_ga_gate_open` → `false`

---

## §4 · DAILY RHYTHM (while T4 runs)

- **Morning (5 min)** — read §0; check `open_holds`; read previous day's `day-N.md`
- **During the day** — work the current task; ALL stage discipline from EXECUTION_WORKBOOK §2 applies
- **Evening (10 min)** — write today's `day-N.md` (≤ 200 words); update §0; commit with `[T<n>] <stage>: <detail>; accept <p>/<t>`
- **End of day 7** — generate `week-1-report.md`; trigger L1 reviewer agent

---

## §5 · INHERITED CONTRACTS

Unchanged from `EXECUTION_WORKBOOK.md` and `NEXT_PLAN_WORKBOOK.md`:

- §1 GROUND RULES (extended above)
- §2 SESSION PROTOCOL — BOOT (5 min) / WORK / EXIT (10 min) checklists
- §4 CROSS-CUTTING STANDARDS — testing, commit format `[T<n>] …`, ADR conventions, event-log shape, idempotency map
- §5 L1 / L2 / L3 three-tier contract
- §6 EVIDENCE format
- §7 UPDATE PROTOCOL
- §8 ESCALATION & HOLD

When this spec contradicts the parent workbooks, **this spec wins** for the duration of T1–T7. After T7 closes, the parent NEXT_PLAN_WORKBOOK resumes authority and this spec archives to `docs/specs/RESTORE-1-closed.md`.

---

## §6 · SESSION LOG (append-only, **newest on top**)

```
### s_<NNNN> — <UTC> — <hours>h
- task_in: T1 → task_out: T1.fix-1
- flags_flipped: [legacy_launchd_orphans_running]
- commits: [a1b2c3d]
- holds_opened: 0 · holds_resolved: 0
- next_action: <see §0>
- notes: <one or two sentences>
```

#### s_0001 — placeholder (not yet started)

- task_in: — → task_out: —
- next_action: T1 launchd purge
- notes: CC_RESTORE_SPEC.md created 2026-05-27. 7 tasks queued. T1 unblocks everything else.

---

## §7 · QUICK ANSWER (the 5 things to remember)

1. **§0 first.** Read the honesty_flags. If any is `true`, that's the work.
2. **No skipping.** T1 must close before T2. T4 cannot start until T1–T3 close.
3. **Templates are not evidence.** day-2…7 will be deleted by T4 step 2 — that's intentional, not data loss.
4. **75 proposals is the canary.** If you see another flood, raise a HOLD before adding any new RoadmapAgent code.
5. **rc2 is honest. v2.2.0 without the 72h soak is not.** T5 forces the choice; either path is valid as long as the ADR makes it explicit.

If you can only do one thing this session: **T1 (purge legacy launchd)**. Until that closes, every metric is noisy.
