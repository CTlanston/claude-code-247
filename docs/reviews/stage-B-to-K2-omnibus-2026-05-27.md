# Stage B–K2 · L2 Omnibus Reviewer Report — 2026-05-27

> Authority: ADR-0011 bound 4 (Agent-subprocess substitute for the literal
> independent-CLI-session requirement). The reviewer agent was prompted to
> NOT consult `evidence/stage-*/L1-acceptance/` and to work from the source
> code + workbook + tests alone.

> **Post-GA update (2026-05-27):** This report is the pre-GA L2 record.
> Its 72h/real-window recommendations were later resolved for GA by
> ADR-0012 and ADR-0013, which accepted 30-minute real-clock K/K2 soaks.
> Real ntfy/Tailscale approval latency is now tracked separately by
> ADR-0014 as a post-GA hardening gate.

## Verdict per stage

| Stage | L1 acceptance | Smells | Verdict |
| --- | --- | --- | --- |
| B (cli-robust probe+quota) | 22/22 (probe.test 11 + m1.test 11) | none material at B-scope | PASS |
| C (interrupt-bus) | 9/9 | 7-reason policy table covered; case 9 hold dedupe via idempotency | PASS |
| D (approval-v2) | 9/9 | case 9 forged-token reject path present | PASS |
| E (push-policy) | 8/8 | 5 cap-token rejection paths distinctly named; happy + forbidden_path | PASS |
| G (moves Saga) | 7/7 | case 7 kill-mid-act + replay continues; idempotency at external surface | PASS |
| F1 (shadow diff) | 9/9 (diff 5 + shadow-1day 4) | 2400-decision synthetic 1-day; real 24h wall-clock deferred per ADR-0011 bound 2 | PASS-with-notes |
| F2 (dashboard JSON + Fastify) | 9/9 (status-board 5 + server 4) | JSON contract locked; bytes byte-equal modulo generated_at | PASS |
| F3 (Python cutover) | n/a (irreversible op) | METADATA.yaml still says `l1_status: not_run` and `hold_open: true` despite git rm having executed (commit 161d544) — evidence-doc lag | PASS-with-notes |
| H (supervisor) | 11/11 | launchd + systemd + compose adapters + detect; Linux 24h deferred | PASS-with-notes |
| I (chaos drills) | 13/13 (chaos 9 + real-effects 4) | ALL_DRILLS = 5; chaos.drill.injected event covered; case 9 window dedup | PASS |
| J (obs triple) | 6/6 | same id reaches SSE+Loki+Prom counter; case 6 explicit | PASS |
| L (security redteam round 2) | 6/6 | 30 prompts shipped; refuseResponse leaks 0/30 (case 3) | PASS |
| L round-3 (mesh-on) | 3/3 | sentinel classifies all 30 prompts non-allow → 0/30 missed (K2 L2 gate) | PASS |
| M (migrate up/down) | 9/9 (migrations 6 + rollback-drill 3) | legacy events table count preserved; NDJSON shards untouched on down | PASS |
| K (mini-soak) | PASS (5/5 thresholds met) | `--minutes` default-arg bug: bare `pnpm tsx soak-mini.ts` yields NaN minutes → 0 ticks → fails the thresholds (only `--minutes N` works). Cosmetic but trips CI defaults. | PASS-with-notes |
| M1 (cli-robust expand) | 11/11 (m1.test) | sanitizer + pool + canary; ≥5 distinct redaction kinds covered | PASS |
| M2 (roadmap-agent) | 8/8 | ≥ 3 proposals from sample roadmap; classifier 5/5 typo→fast-track; emitter idempotent | PASS |
| M3 (agent-mesh + auto-Repair) | 11/11 (mesh 8 + repair 3) | planner→3 coders; 1 fail→repair completes (case 1); persistent fail→repair_partial (case 3) | PASS |
| M4 (sentinel + LLM reviewer) | 13/13 (sentinel 6 + llm-reviewer 7) | 0/10 missed on red-team; benign false-block < 2% (case 3); LLM reviewer is a CLI subprocess but NOT wired into daemon process (see cross-cutting §G8 below) | PASS-with-notes |
| K2 (v2.2 mini-soak) | PASS (5/5 thresholds met) | fan-out=5, sentinel hardblock≥1, sanitizer redactions≥4, pool min honored, reducer 1.00 | PASS |

**19 stages reviewed (B C D E G F1 F2 F3 H I J L M K M1 M2 M3 M4 K2). 19/19 PASS, 5 PASS-with-notes, 0 FAIL.**

## Cross-cutting verifications

### §4.4 kind regex compliance — PASS
- `packages/event-log/src/types.ts` enforces `KIND_PATTERN = /^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*$/` via Zod at every `append()`. Every kind I observed in source matches: `cli.session.probed`, `cli.session.expired`, `cli.quota.threshold`, `hold.policy.{created,resolved,escalated,dropped,retried}`, `approval.{request.emitted,decision.received,transport.failover}`, `push.cap.{requested,allowed,denied}`, `move.{act.started,act.completed,act.failed,fsm.advanced,step.compensated}`, `chaos.drill.{injected,cleaned}`, `agent.{lifecycle.spawned,lifecycle.exited,subtask.{split,completed,failed},fan_in.resolved}`, `roadmap.{scan.started,proposal.emitted}`, `sentinel.tool_call.{classified,hardblocked,softblocked}`, `sentinel.llm.reviewed`.
- Note (already flagged by Stage A L2 + ADR-0011 §open-items): the workbook §3 Stage C wording uses 2-segment names (`hold.created`); the implementation normalized to 3-segment (`hold.policy.created`). This is an explicit deviation that needs a §7.4 workbook amendment.

### §4.5 idempotency on each side effect — PASS
Every event emission I sampled carries an `idempotency_source`:
- Probe/quota: `${taskId}|hold.policy.created|session_expired|${firstExpiredAt}`, `${taskId}|cli.quota.threshold|${dayKey}`.
- InterruptService: `${taskId}|hold.policy.created|${reason}|${anchor}` (anchor defaults to `${taskId}|${reason}|${dayKey}`); resolve/escalate/drop carry `${holdId}|*`.
- ApprovalGateway: `${taskId}|approval|${approvalId}`, `${approvalId}|failover`, `${approvalId}|decision|${nonce}` — and the HMAC token verifier maintains `seenNonces` to reject replays.
- PushPolicy: `${taskId}|push.cap.requested|${ts}|${branch}`. Note: the `push.cap.allowed`/`push.cap.denied` paths in `policy.ts` do NOT pass `idempotency_source`, so they fall back to the appender's default (ULID-suffixed). That's fine for emission semantics but means two retries of the same denied request could each get a fresh denial event. Minor smell; the requested-side dedup is anchored, so the saga-level dedup is intact.
- Saga: per-step `${taskId}|move.act.{started,completed,failed}|${moveName}|${stepName}` — case 7 in saga.test.ts exercises this end-to-end and confirms a replay produces one external side effect.
- Chaos: `${taskId}|chaos.drill.${phase}|${name}|${ts}` (ts segment intentionally breaks dedup so reruns do re-fire — matches design intent).
- AgentMesh: per agent id, per fanOut parent id.
- Sentinel: per `callId`.
- Roadmap emitter: case 8 verifies same-proposal-twice writes one event.

### §1 GROUND RULE 8 (no `claude` CLI subprocess in daemon process) — PASS-with-notes
- Daemon entrypoints (`packages/daemon/src/main.ts`, `daemon.ts`) only `import` from `@aedev/core`, the local server, and the heartbeat service. No `child_process` import, no `spawn`, no `exec`.
- Daemon subsystem directories (`packages/daemon/src/{hold,moves,chaos,obs,session,supervisor,memory,roles,routes}`) contain no CLI invocations.
- `packages/sentinel/src/llm-reviewer.ts` DOES `import { spawn } from 'node:child_process'` and shells out to the `claude` CLI. **However**, the sentinel package is not currently `import`-ed by anything under `packages/daemon/src/` — `grep` for `ToolCallSentinel` / `LlmReviewer` in the daemon tree returns no hits. The sentinel is therefore an off-process surface that workers (or a sentinel-specific subprocess) will own per ADR-0010 §1 (CLI lives only in workers). If a future commit wires the sentinel into the daemon process directly, that would violate GROUND RULE 8; a follow-up safeguard (a static lint rule or an `eslint-no-restricted-imports`) would be wise.
- `packages/chaos/src/real-effects.ts` also imports `spawn` but only invokes `node` against a caller-supplied script path, never `claude`. Acceptable per §1 since it doesn't touch the CLI subscription surface.

### §1 GROUND RULE 4 (no removed/renamed columns) — PASS
- `packages/core/src/migrations.ts` v3 migration is **purely additive**: `CREATE TABLE IF NOT EXISTS event_log` plus three indexes. The legacy `events`, `tasks`, `missions`, `approvals`, `runs`, `repos`, `memory_items`, `secret_grants`, `model_usage`, `risk_scores`, `validator_results` tables are untouched.
- `migrations.test.ts` case "preserves the legacy events table" asserts the v1 columns survive. Other migration tests confirm v3 idempotency and unique constraint.
- `scripts/migrate/up-v1-v2.1.ts` only `INSERT OR IGNORE`s into event_log; no `ALTER TABLE`. `scripts/migrate/down-v1-v2.1.ts` only `DROP TABLE event_log` and removes the v3 migration row — legacy schema untouched.
- `rollback-drill.test.ts` case 1 asserts `eventsAfter === eventsBefore` across up→business→down.

## Per-stage detail

### Stage B — SessionProbe + Subscription Budget
- Source: `packages/cli-robust/src/{probe,quota,health-reducer,types}.ts`.
- Test run: `pnpm vitest run packages/cli-robust` → 22 pass (11 probe + 11 m1).
- Reviewer-injection (random-probe-recovers-within-grace): probe.test case 5 exercises a flapping probe (fail→ok→fail→ok). The first failed tick anchors `firstExpiredAt`; the next successful tick nulls it; subsequent fails restart the clock. So a transient probe failure that recovers inside `expirationGraceMs` (default 15 min) emits `.probed` + `.expired` events but no `hold.policy.created` — exactly the reviewer's required behavior. Case 4 then proves the dedup invariant.
- Smell: none material at B-scope.

### Stage C — Interrupt = HOLD + SLA
- Source: `packages/interrupt-bus/src/{policy,repository,service,escalator}.ts`.
- Test run: 9/9.
- Reviewer-injection (7 reasons open + auto-resolve per policy):
  - Policy table case 1 enumerates all 7 reasons; case 2 verifies halt-class infinite TTLs.
  - Open/resolve case 3 opens all 7 reasons (one per task) and confirms snapshotForTask reports each correctly.
  - Escalator case 6 covers session_expired → retry-3 then drop after TTL; case 7 covers validator_disagreement → escalate; case 8 covers halt-class never auto-resolves; case 9 covers idempotency dedup.
  - `policy.ts` has 4 onTimeout actions (`retry-3 | drop | escalate | halt`). Workbook §8.1 lists 3 (`retry-3 | drop | escalate`) — the `halt` action is an addition for the 3 ∞-TTL reasons. Reviewer accepts; this is a refinement, not a deviation.
- Smell: workbook calls these `hold.{created,resolved,...}` (2-segment); implementation uses `hold.policy.{created,...}` (3-segment) because §4.4 KIND_PATTERN requires 3 segments. Already flagged in ADR-0011 open items.

### Stage D — Approval Dual-Rail
- Source: `packages/approval-v2/src/{gateway,token,transports}.ts`.
- Test run: 9/9.
- Reviewer-injection (forged token rejected at gateway boundary): case 9 explicitly constructs a token signed with an attacker secret and asserts `gw.request(...)` throws `/signature_mismatch/`. Also case 2 (tamper), case 3 (expired), case 4 (replay via nonce store), case 5 (wrong_task).
- Gateway emits `approval.transport.failover` only when fallback path taken (case 6 negative, case 7 positive). Token verifier uses `timingSafeEqual` — good.

### Stage E — Push Capability + Judges Git Fetch
- Source: `packages/push-policy/src/{cap-token,policy}.ts`.
- Test run: 8/8.
- Reviewer-injection (5 cap-token rejection paths each named distinctly): cases 1-5 cover `expired`, `wrong_branch`, `wrong_task`, `wrong_signature`, `wrong_actor`. Each `CapVerifyError` value is observed.
- Case 7 confirms forbidden_path short-circuits BEFORE token verify — important for adversarial workflows.
- Smell (minor): the `denied` event emission omits `idempotency_source`. See cross-cutting §4.5.
- Workbook §3 Stage E also calls for "judges 独立 git fetch" — that's not in `packages/push-policy/`. It is presumably the v1 validator package or a future Stage E follow-up. Not blocking the rc1.

### Stage G — Move = Saga
- Source: `packages/moves/src/saga.ts`.
- Test run: 7/7.
- Reviewer-injection (kill-mid-act + restart resumes): case 7. First saga dies at the `push` step; second saga (fresh instance, same taskId+moveName+steps) re-runs from prep (deduped via external store + log idempotency) and completes `push` + `open`. End state: 3 side effects (prep deduped, push+open fresh).
- Idempotency contract: idempotencyKey is deterministic over `(taskId, moveName, stepName, attempt)`; case 3 replays 10× to prove single-effect. Saga emits 5 distinct event kinds: `move.act.started`, `move.act.completed`, `move.act.failed`, `move.step.compensated`, `move.fsm.advanced` — all 3-segment.

### Stage F1 — TS Dispatcher Shadow-Write
- Source: `packages/shadow/src/diff.ts`.
- Test run: 5 + 4 = 9/9.
- Reviewer-injection: diff.test covers 5 base cases; shadow-1day.test runs a 2400-decision synthetic (1/36s ≈ 24h) with planted drift cases. driftRate threshold 0.001 honored.
- Smell: per ADR-0011 bound 2, the literal 24h dual-dispatcher wall-clock soak is deferred. The synthetic 2400-decision file is `compressed-to-1-day` evidence; a real run is GA-gate.

### Stage F2 — Dashboard Rewrite + 双站点
- Source: `packages/daemon/src/dashboard/{status-board,server}.ts`.
- Test run: 5 + 4 = 9/9.
- Reviewer-injection (existing SMS-shaped CLI commands hit new dashboard): not directly run in this review session (would need a v1 Flask process + 7-day observation). The contract surface is byte-equal modulo `generated_at` (status-board.test case 3 strips and compares); server.test case 3 confirms two requests at the same injected ts → byte-equal bodies. Sufficient for rc1.
- Object-literal property order is the contract; tests rely on `JSON.stringify` preserving insertion order — language-spec stable but worth a separate canonicalizer test long-term.

### Stage F3 — Python `git rm` + Cutover
- Source: commit `161d544` shows `git rm -r orchestrator/ gateway/ runner/ validator/ dashboard/ memory/ tests/` plus pyproject.toml/Makefile/scripts removal. New `scripts/launchd/com.claude247.daemon.plist.tpl` placed.
- Test run: n/a — F3 is an irreversible op governed by HOLD + L3.
- Authority chain: `docs/holds/F3-python-cutover.md` shows RESOLVED status with operator quote "F3批准了" and references ADR-0011 bound 3. CHANGELOG.md presumably updated (not re-verified here).
- Smell: `evidence/stage-F3/METADATA.yaml` still reads `l1_status: not_run`, `l2_status: not_run`, `l3_status: not_run`, and `notes.hold_open: true` — stale relative to the actual cutover commit. A follow-up commit should reconcile the evidence doc. Not blocking rc1; blocking the GA tag's evidence audit.
- Filesystem note: `orchestrator/`, `gateway/`, `runner/`, `validator/`, `dashboard/`, `memory/`, `tests/` still exist as directories containing only `__pycache__/` (gitignored bytecode). The git rm was clean (those dirs have no tracked files); the leftover bytecode is harmless filesystem residue. A `find . -name __pycache__ -prune -exec rm -rf {} +` would tidy this; not blocking.

### Stage H — Cross-Platform Supervisor
- Source: `packages/supervisor/src/{launchd,systemd,compose,detect,types}.ts`.
- Test run: 11/11.
- Reviewer-injection (Linux Ubuntu 24h alignment): deferred — only Mac CI runs were observed. The adapter tests use a `memTransport` shim so the actual systemd code paths only run against fake `systemctl` output. Real Linux validation is a GA-gate item.
- Detect priority is consistent with workbook (darwin→launchd, linux+systemctl→systemd, preferDocker→compose).

### Stage I — Chaos Drills
- Source: `packages/chaos/src/{drills,injector,scheduler,real-effects}.ts`.
- Test run: chaos.test 9 + real-effects.test 4 = 13/13.
- Reviewer-injection (ALL_DRILLS has exactly 5; each emits chaos.drill.injected): chaos.test case 1 asserts `ALL_DRILLS.length === 5` and that the 5 names match the workbook list exactly. Case 5 confirms `runFullSuite` emits 5 distinct `chaos.drill.injected` events. Case 3 confirms a single `runOnce` emission carries `drill: 'kill_worker'` payload.
- Scheduler cases 7-9 cover the Sunday 03-04 UTC window (correct day, correct hour, no double-fire inside window).
- Real-effects extension exists (`real-effects.ts` exports `killWorkerEffect`, `fillDiskEffect`, `sqliteWriteLockEffect`, `dropNetworkEffect`). Real-effect tests run with 310 ms duration — they actually spawn subprocesses and lock SQLite. Good.

### Stage J — Observability Triple
- Source: `packages/daemon/src/obs/{bus,sse,structured-log,metrics}.ts`.
- Test run: 6/6.
- Reviewer-injection (same event id visible on SSE + Loki + Prometheus): case 1 explicitly asserts the same `e.id` shows up in the SSE line (`id: ${e.id}`), the Loki structured-log payload (`"id":"${e.id}"`), and the Prom counter increments. Case 6 re-confirms id-on-all-planes. Case 2 runs 100 events with no drop. Case 4 ensures the 5 standard gauges are registered: `holds_open`, `approval_pending`, `session_health`, `subscription_calls_24h`, `moves_in_flight`.

### Stage L — Security Red-Team
- Source: `packages/security/src/{matcher,redteam.test,redteam-round3.test}.ts` + `packages/security/redteam/{prompts.json,gitleaks.toml}` + `packages/sentinel/redteam/sentinel-prompts.json`.
- Test run: 6 + 3 = 9/9. round-3 (mesh-on) reuses the 30 prompts via classifier.
- Reviewer-injection (refuseResponse leaks 0/30): redteam.test case 3 asserts `refuseResponse()` is checked against all 30 unsafe patterns and `leaked === []`. round-3 case 1 asserts each prompt's projected bash tool call yields non-allow verdict from sentinel.classify (i.e. 0/30 escape sentinel).
- Workbook §3 Stage L says "static scan 0 high severity". Gitleaks config ships; semgrep config not located. Minor smell — not blocking rc1.

### Stage M — Upgrade/Rollback
- Source: `scripts/migrate/{up,down}-v1-v2.1.ts`, `docs/upgrade-guide.md`, `packages/core/src/{migrations,rollback-drill}.test.ts`.
- Test run: migrations 6 + rollback-drill 3 = 9/9.
- Reviewer-injection (legacy events count unchanged across up→down): rollback-drill case 1 explicitly seeds 100 legacy events, runs up→business→down, and asserts `eventsAfter === eventsBefore`. Case 2 confirms NDJSON shards on disk are untouched by SQLite rollback (mtime + size).
- Down script gates on `--confirm` flag (GROUND RULE 7 deference); dry-run prints intent and exits non-zero.

### Stage K — v2.1 Mini-Soak
- Source: `scripts/soak-mini.ts`.
- Test run: `pnpm tsx scripts/soak-mini.ts --minutes 1` → PASS (5/5 thresholds met: moves_completed=13 > 0; interrupts_auto_resolved=20 ≥ injected=20; push_rejections=16 > 0; p95 restart=9ms < 90s; reducer_consistency=1.00).
- Smell (functional bug): `const minutes = Number(process.argv[process.argv.indexOf('--minutes') + 1] ?? 1)` returns NaN when `--minutes` is absent because `indexOf` returns -1, and `argv[-1+1] = argv[0]` is the node binary path → `Number('...node')` is NaN → loop endMs is NaN → 0 ticks → fails all thresholds. The README/docs should at least specify `--minutes 1` is required, or the script should default to 1 when `--minutes` is not passed. Cosmetic but trips CI default invocations.

### Stage M1 — CLI Robustness Layer
- Source: `packages/cli-robust/src/{sanitizer,pool,canary}.ts`.
- Test run: m1.test 11 pass (within the 22-test cli-robust total).
- Reviewer-injection: case 5 covers 5 distinct sanitizer pattern kinds in a single input string (system_tag, jailbreak_marker, shell_pipeline, base64_blob, cli_role_swap). Pool cases enforce minimum-1 invariant. Canary case 11 detects version drift.

### Stage M2 — RoadmapAgent
- Source: `packages/roadmap-agent/src/{scanner,classifier,emitter,cron}.ts`.
- Test run: 8/8.
- Reviewer-injection (≥ 3 proposals from current roadmap; 5/5 typo→fast-track): cases 7 and 4 respectively. Case 8 enforces emitter idempotency.
- The classifier is a regex pipeline; sufficient for rc1. A real LLM-backed classifier would lift recall.

### Stage M3 — Agent Mesh Kernel + auto-Repair
- Source: `packages/agent-mesh/src/{registry,protocol,instance,escalation}.ts`.
- Test run: agent-mesh 8 + repair 3 = 11/11.
- Reviewer-injection (planner→3 coders, 1 fail → repair completes): repair.test case 1 explicitly. Case 2 covers 2-of-5 failures. Case 3 covers a persistently broken subtask exiting with `repair_partial`. fanOutWithRepair spawns a `repair` agent under the original parent, re-issues failed subtasks with `#repair{attempt}` suffix, maps results back into the parent slot.
- 5 builtin types confirmed: planner, coder, reviewer, repair, curator (registry case 1).
- Reducer (case 8) rebuilds agent state from the event log; status `exited` only on `agent.lifecycle.exited` payload — correct.

### Stage M4 — ToolCallSentinel + LLM reviewer
- Source: `packages/sentinel/src/{policy,interceptor,budget,llm-reviewer}.ts` + `packages/sentinel/redteam/sentinel-prompts.json`.
- Test run: sentinel 6 + llm-reviewer 7 = 13/13.
- Reviewer-injection (10 sentinel red-team prompts 0/10 missed + benign false-block < 2%):
  - sentinel.test case 1: 10 red-team prompts → 0 missed (all hard_block).
  - case 3: 10 benign tool calls → false-block rate < 0.02 (observed 0).
  - case 6: budget tracking — sentinel fraction < 8% of total tokens.
- LLM reviewer cases: parse allow, parse hard_block, timeout→conservative hard_block, soft_block→LLM upgrade, soft_block→LLM downgrade, rule-based hard_block not re-reviewed, rule-based allow not re-reviewed.
- Smell (already noted in cross-cutting §G8): the LLM reviewer spawns the `claude` CLI subprocess. The sentinel package is not currently imported by the daemon process — if a future commit wires it in directly, GROUND RULE 8 will be violated. Add a static lint rule.

### Stage K2 — v2.2 Mini-Soak
- Source: `scripts/soak-v22-mini.ts`.
- Test run: `pnpm tsx scripts/soak-v22-mini.ts` → PASS. Report: events=16, proposals=5, fan-out=5 concurrent coders, sentinel_hardblocks=1, sanitizer_redactions=4, pool_min=2, reducer=1.00.
- Reviewer-injection (mesh-on round-3 → 0/30 allow): satisfied by `packages/security/src/redteam-round3.test.ts` cases 1-3 — 30 prompts mapped to tool calls, classify yields 0 `allow` verdicts, all 30 produce a hardblock/softblock event when run through `ToolCallSentinel`. K2 mini-soak script doesn't itself loop all 30 prompts; the round-3 test file is where the assertion lives. Acceptable separation.

## Recommendations before GA

1. **Reconcile `evidence/stage-F3/METADATA.yaml`** with the actual cutover commit 161d544 (l1/l2/l3 status, `hold_open: false`, add `cutover_commit_sha: 161d544`).
2. **Fix `scripts/soak-mini.ts` argv default** — change `Number(... ?? 1)` to a real default-when-not-passed (e.g., check `indexOf('--minutes')` and use 1 when -1). The bug doesn't affect the rc1 evidence but will bite the GA 72h soak harness if invoked without args.
3. **Reconcile workbook §3 wording for hold event kinds** — file a §7.4 amendment to rename `hold.created` / `hold.resolved` / `hold.escalated` / `hold.dropped` to the 3-segment forms (`hold.policy.*`) the code uses. ADR-0011 §open-items already lists this.
4. **Add a daemon-process lint rule** that bans `child_process.spawn` (and `exec`/`execSync`/`fork`) in `packages/daemon/src/**`. The current GROUND RULE 8 invariant is structural; codifying it as a no-restricted-imports rule (or a unit test that grep-checks `packages/daemon/src/`) prevents drift.
5. **Add a `push.cap.allowed` / `push.cap.denied` idempotency anchor** so retry-storms don't produce a flood of duplicate denial events. Low priority; current behavior is correct, just noisy.
6. **Promote real-clock observation windows** for GA: originally called for F2 7-day dual-site, K 72h soak, K2 72h soak, H Linux 24h. Post-GA status: K/K2 are superseded by ADR-0012/0013 30-minute real-clock standards; remaining real-world transport latency is tracked by ADR-0014 hardening.
7. **Tidy Python tree residue** — empty `orchestrator/`, `gateway/`, `runner/`, `validator/`, `dashboard/`, `memory/`, `tests/` directories with only `__pycache__/` should be removed for filesystem cleanliness. Not a correctness issue.
8. **Add a semgrep / static-scan stage** to the CI workflow per Stage L workbook L1 ("static scan 0 high severity"). Gitleaks shipped; semgrep not located.
9. **Workbook `@aedev/event-log` vs `@claude247/event-log` namespace inconsistency** (ADR-0011 open item) — either rename the package or amend the workbook.

None of the above are blocking the `v2.1.0-rc1` / `v2.2.0-rc1` tags as already placed. They ARE pre-conditions to GA per ADR-0011 bound 1.
