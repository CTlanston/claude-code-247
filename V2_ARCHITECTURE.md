# claude-code-247 v2.0 — Architecture & Implementation Plan

> **Status:** Design — not yet implemented.
> **Authored:** 2026-05-26.
> **Supersedes:** the dual-kernel (Python + TypeScript) layout described in [ADR-0009](docs/adr/0009-aedev-as-primary-control-plane.md). This document is the source of truth for v2.0.
> **Decision lineage:** Subsequent ADR-0010 (to be written in Stage A) will reference this file.

---

## 1. Summary

v1.0.0 GA shipped on 2026-05-25 with an owner-waived 24h soak gate. It demonstrates the shape of a local-first 24/7 autonomous coding coworker, but several real-world failure modes are not yet handled (subscription session expiry, quota exhaustion, prompt-injection on the push path, long-task resume, cross-platform install, chaos resilience). v2.0 is the architectural redesign that closes those gaps and produces a system that can be handed to a second user without daily author intervention.

The v2.0 redesign rests on **five decisions**:

| # | Decision | Implication |
|---|---|---|
| 1 | **Collapse to a TypeScript-only control plane.** | All runtime ownership (dispatcher, notifications, session, hold management) moves to `packages/daemon`. Python is removed. |
| 2 | **Move the watchdog dashboard to Fastify static HTML** served by the same daemon on port 7247. | Single process, single port, single binary path. |
| 3 | **Delete the Python tree outright** (do not archive into `archive/`). | `git rm -r` of `orchestrator/`, `gateway/`, the Python `runner/`, the Python `validator/`, `dashboard/`, the Python `memory/`, `pyproject.toml`, `.venv/`, all Python tests. `archive/auto-evo/` is unrelated legacy and is not touched. |
| 4 | **Acceptance per stage = functional verify + 1 hour smoke soak.** Stage K is the only stage that runs a true 24h+ soak. | Predictable cadence; ~8h additional total cycle time. |
| 5 | **Approval transport = Claude Dispatch (primary) + Tailscale (fallback).** | Stage D opens with a one-week spike to confirm Dispatch can carry daemon-defined approval events. If the spike fails, fallback path is built; either way the operator gets one mobile UX. |

---

## 2. Background: what v1.0.0 leaves unsolved

A truthful gap list, in priority order. v2.0 must address P1 in full and P2/P3 to the extent compatible with a single-user, single-Mac (plus Linux/Docker portability) deployment.

### P1 — blocks handing the system to a non-author

1. **Subscription session health is not modeled.** Local `claude` CLI auth lives in the macOS keychain; sessions expire silently. There is no probe and no operator alert.
2. **`$0 cost` is misleading.** The figure refers to Anthropic API spend; the user's subscription quota is consumed continuously and is not measured. A 24/7 daemon will hit subscription quota ceilings.
3. **Approval is fire-and-forget.** `approval_required` events emit ntfy push but offer no closed-loop mechanism for the operator to record a decision from the phone.
4. **`interruption-policy.ts` is unwired.** Seven critical reasons (`secret_grant_request`, `production_incident`, `validator_disagreement`, …) are declared but never trigger anything in production.
5. **No failure-recovery drills.** Worker process death, Mac sleep, network drop, SQLite write-lock, Docker daemon death — none are exercised; only dispatcher restart was covered in M21.
6. **Prompt-injection on the push path.** `forbidden_paths` is a content-based denylist. A prompt that legitimately edits an allowed path but pushes to `main` is not blocked by a structural rule.

### P2 — blocks shipping as a product

1. macOS + launchd only (no Linux/systemd, no Docker Compose).
2. Single SQLite, single ntfy topic, single subscription session — no multi-tenant story.
3. Only CLI intake + GitHub webhook intake (no Linear/Jira/Slack).
4. Single CLI call is bounded at 10 minutes with no resume mechanism for longer tasks.
5. TypeScript daemon is not in the launchd chain; only the Python dispatcher is supervised. This is a dual-plane bug.

### P3 — UX gaps

1. Dashboard is read-only; no operator action UI (re-run, cancel, approve).
2. `/events` SSE route exists but no live UI consumes it.
3. Prometheus `/metrics` endpoint exists, no Grafana board or alert rule.

---

## 3. The ten architectural shifts

Each row maps a v2 change to the v1 problem(s) it closes.

| # | Change | Closes |
|---|---|---|
| 1 | **TS-only control plane.** Python is removed; `packages/daemon` owns dispatcher, notifications, session, holds, approvals, push policy, moves, chaos, observation, and supervisor. | P2.5, P1.4 |
| 2 | **`SessionManager` actor** owns the `claude` CLI subprocess. 5-minute heartbeat probe; three consecutive failures → `HOLD-session-expired`, ntfy push, pause new task starts, wait for `claude247 session refresh`. | P1.1 |
| 3 | **Subscription budget model.** `subscription_budget(date, model, calls, threshold)` table. Threshold alert and a hard `HOLD-quota-exhausted` on ceiling. `$0 cost` is replaced by `subscription_usage: { opus, sonnet, threshold }`. | P1.2 |
| 4 | **HOLD as a first-class entity.** `holds(id, task_id, reason, payload_json, created_at, resolved_at, resolved_by)` table; dispatcher only picks tasks where `hold_count = 0`; `claude247 holds list / show / resolve <id>` CLI; `logs/holds.md` is the auto-mirrored append-only ledger. The seven `interruption-policy.ts` reasons are wired here. | P0.2, P1.4 |
| 5 | **`ApprovalGateway` with a closed loop.** Signed token per `approval_required`; ntfy deep-link to `https://<host>/approve/<token>` (Tailscale-routed) or the Claude Dispatch native channel; HTTP POST writes the decision into `approvals`; the waiting task is woken by SSE. | P1.3 |
| 6 | **Push-time security gate.** All `git push` calls flow through `PushPolicy.check()`: hard-block forbidden-path diffs; route `.github/**`, `CLAUDE.md`, `AGENTS.md` changes through `ApprovalGateway`; mainline pushes require validator double-sign plus human approval. | P1.6 |
| 7 | **Task = sequence of recoverable moves.** Each CLI invocation is one bounded move (≤10 minutes). Evidence is committed to the workspace and DB after each move. Resume = re-read the last evidence and craft the next prompt. | P2.4 |
| 8 | **Cross-platform supervisor abstraction.** `claude247 install` detects the OS, generates a launchd plist (Mac), systemd unit (Linux), or docker-compose file (portable), and brings the service online. | P2.1 |
| 9 | **Chaos drill suite.** Scheduled drills: kill worker, fill disk, drop network, expire session, hold SQLite write-lock. Assert HOLD appears → resolve → task resumes. | P1.5 |
| 10 | **Observability triple.** `/events` SSE (all events), `/metrics` Prometheus (with new gauges), structured JSON logs to file for Loki/Grafana ingestion. | P3 |

---

## 4. System overview

```
                       ┌─────────────────────────────────────┐
                       │      claude247d (TS daemon)         │
                       │   single binary · port 7247         │
                       │                                     │
  Claude Dispatch  ◄───┤ ApprovalGateway                     │
  (primary) /          │ SessionManager (owns claude CLI)    │
  Tailscale (fallback) │ SubscriptionBudget                  │
                       │ HoldService                         │
  ntfy.sh         ◄────┤ NotificationManager (11 events)     │
                       │ Dispatcher (30s tick)               │
  GitHub webhook  ─────┤ PushPolicy.check()                  │
                       │ MoveRunner (≤10 min / move)         │
                       │ ChaosDrills (scheduled)             │
                       │ /events SSE · /metrics · /status    │
                       │ /dashboard (Fastify static HTML)    │
                       └─────────────────┬───────────────────┘
                                         │
                                         ▼
                         SQLite ~/.claude-code-247/state/claude247.db
                         ├─ tasks, runs, prs                (kept from v1)
                         └─ holds, approvals, session_health,
                            subscription_budget, moves      (new)

Supervisor: launchd (Mac) | systemd (Linux) | docker-compose (portable)
            ├─ com.claude247.daemon  (single keep-alive job)
            └─ com.claude247.backup  (daily 03:17 UTC — kept from v1)
```

---

## 5. Data model — five new tables

```sql
holds (
  id              INTEGER PRIMARY KEY,
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  reason          TEXT NOT NULL,                 -- one of the 7 interruption reasons
  payload_json    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  resolved_at     TEXT,
  resolved_by     TEXT
);

approvals (
  token           TEXT PRIMARY KEY,              -- HMAC-signed
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  request_json    TEXT NOT NULL,
  status          TEXT NOT NULL,                 -- pending | approved | rejected | expired
  decided_at      TEXT,
  decided_by      TEXT,
  transport       TEXT NOT NULL                  -- dispatch | tailscale
);

session_health (
  id                      INTEGER PRIMARY KEY,
  last_ok_at              TEXT,
  last_failure_at         TEXT,
  consecutive_failures    INTEGER NOT NULL DEFAULT 0,
  last_model              TEXT,
  last_error              TEXT
);

subscription_budget (
  date            TEXT NOT NULL,                 -- YYYY-MM-DD
  model           TEXT NOT NULL,                 -- opus | sonnet | haiku
  calls           INTEGER NOT NULL DEFAULT 0,
  threshold       INTEGER NOT NULL,              -- per-model daily threshold
  alerted_at      TEXT,
  PRIMARY KEY (date, model)
);

moves (
  id              INTEGER PRIMARY KEY,
  task_id         INTEGER NOT NULL REFERENCES tasks(id),
  idx             INTEGER NOT NULL,              -- 0-based move index inside the task
  prompt          TEXT NOT NULL,
  evidence_path   TEXT,
  status          TEXT NOT NULL,                 -- pending | running | done | failed
  started_at      TEXT,
  ended_at        TEXT,
  error           TEXT
);
```

WAL mode is required (the dispatcher and the dashboard read concurrently with writers).

---

## 6. Implementation stages

Stages are sequenced by dependency, **not** by release batch. Each stage acceptance is `functional verify (~30 min) + 1 hour smoke soak`. Stage K is the only stage that runs a real 24h+ soak.

### Stage A — Foundation (~2 days)

1. Database migrations introducing the five new tables; enable WAL mode.
2. Scaffold `packages/daemon/src/{session,hold,approval,push-policy,moves,chaos,obs,supervisor}/index.ts` (empty exports first; `pnpm typecheck` must stay green).
3. Author `docs/adr/0010-ts-only-collapse.md` referencing this document; add a TS-only banner to `CLAUDE.md`.

**Acceptance:** `pnpm migrate` succeeds; reverse-dumped schema matches the spec above; `pnpm typecheck` green; ADR file present.

### Stage B — SessionManager and subscription budget (~3 days)

4. `session/manager.ts` owns the `claude` CLI subprocess (one at a time). Methods: `invoke / heartbeat / refresh`.
5. `session/heartbeat.ts`: every five minutes, send a low-cost probe prompt. Three consecutive failures → emit `HOLD-session-expired`.
6. `session/budget.ts`: intercept the adapter call path; increment `subscription_budget(date, model)`; alert at the threshold and HOLD at the ceiling.

**Acceptance:** unit tests cover spawn → exit → restart; mock keychain expiry produces a HOLD within 15 minutes; mock 1000 calls produces a `HOLD-quota-exhausted`.

### Stage C — HOLD as first-class (~3 days)

7. `hold/{repository,service}.ts` — CRUD with a 30-minute fingerprint dedup window.
8. Dispatcher filter: only pick tasks where `hold_count = 0`.
9. CLI commands: `claude247 holds list / show <id> / resolve <id>`.
10. `~/.claude-code-247/logs/holds.md` mirror writer (append-only).
11. Wire the seven `interruption-policy.ts` reasons through the new HOLD service.
12. ntfy notification integration on HOLD `created` / `resolved` (reuse the 11-event channel).

**Acceptance:** each of the seven reasons can be injected via a test harness and shows up in three places — `holds` table, `holds.md`, ntfy push. Stage B+C 1h smoke soak passes with at least one synthetic HOLD lifecycle.

### Stage D — ApprovalGateway (~5 days, includes spike)

13. **Day 1–2 — Claude Dispatch spike.** Confirm whether Dispatch can carry daemon-defined approval events (vs. only Claude-internal "may I run this?" prompts). Document the API surface and the result in `docs/spikes/dispatch-approval.md`.
14. `approval/gateway.ts` with an `ApprovalTransport` interface and two implementations: `DispatchTransport` and `TailscaleHttpTransport`.
15. `config.yaml` adds `approval.transport: dispatch | tailscale | both`. Default is `dispatch` if the spike passed; otherwise `tailscale`.
16. SSE wake mechanism on `/events?topic=approval`.
17. (Tailscale path) HMAC-signed token URL, `/approve/<token>` endpoint, minimal HTMX approve/reject page.

**Acceptance:** trigger `approval_required`; receive push on the phone; record decision; the waiting task resumes — no desktop interaction.

### Stage E — Push-time security gate (~2 days)

18. `push-policy/policy.ts` prepends every `git push`.
19. Hard-block diffs touching `forbidden_paths`.
20. Force `.github/**`, `CLAUDE.md`, `AGENTS.md` changes through `ApprovalGateway`.
21. Mainline pushes require validator double-sign plus a human approval.

**Acceptance:** a simulated prompt-injection PR that touches a forbidden path is blocked at push time; no `git push` actually fires; HOLD is recorded with the diff payload.

### Stage F — Python collapse (~5 days, includes dashboard rewrite)

22. TS `dispatcher.ts` reproducing the 30s tick and `select_new_task` semantics of `orchestrator/dispatcher.py`.
23. TS `NotificationManager` reproducing the 11 events and the 30-minute fingerprint dedup of `notification_manager.py`.
24. **Fastify static dashboard.** Rewrite `/status-board` with Alpine.js + Pico CSS, served by the daemon on port 7247. JSON contract for `/status-board.json` is preserved (same shape, same field names) so existing tooling keeps working.
25. launchd switch: delete `com.claude247.{dispatcher,orchestrator,dashboard}`; introduce `com.claude247.daemon` as the single keep-alive supervisor. `com.claude247.backup` is preserved.
26. **`git rm -r`** the Python tree: `orchestrator/`, `gateway/`, the Python `runner/`, the Python `validator/`, `dashboard/`, the Python `memory/`, `pyproject.toml`, `.venv/`, all Python tests under `tests/`, all Python launchd plist sources.
27. Remove the `pytest` job from CI.

**Acceptance:** no Python process starts for 24 hours after the cutover; all task flows operate end-to-end on the TS daemon; the same JSON contract is served by Fastify; `claude247 status-board --plain` produces SMS-shaped output.

### Stage G — Moves for resumable long tasks (~3 days)

28. Move model and repository.
29. `MoveRunner`: each invocation ≤10 minutes; evidence committed to the workspace and DB on completion.
30. Resume: on process restart, read the last move's evidence and craft the next prompt.

**Acceptance:** during a synthetic task at move 3, `kill -9` the daemon; on restart the task continues from move 4 with no operator intervention.

### Stage H — Cross-platform supervisor (~3 days)

31. `supervisor/{launchd,systemd,compose}.ts` — three backends behind a single `install / uninstall / status / restart` interface.
32. `claude247 install` detects the OS and selects the backend.

**Acceptance:** one Mac and one Linux host each install and run the same task corpus for 24 hours.

### Stage I — Chaos drills (~2 days)

33. `chaos/drills.ts` injects, on a weekly schedule: kill worker, fill disk, drop network, expire session, hold SQLite write-lock.

**Acceptance:** each of the five injections produces the expected HOLD, the HOLD is auto-resolved or operator-resolved, and the task resumes without residual state.

### Stage J — Observability (~2 days)

34. `/events` SSE stream covers dispatcher ticks, HOLDs, approvals, pushes, moves.
35. `/metrics` gains `holds_open`, `approval_pending`, `session_health`, `subscription_calls_24h`, `moves_in_flight` gauges.
36. Structured JSON logs to file (Loki/Grafana friendly).

**Acceptance:** a single event is observable in all three planes (`grep`, Prometheus, SSE) with consistent identifiers.

### Stage K — Release (~3 days)

37. Full 24h+ soak with stages A–J enabled.
38. Author the real `M22c_SOAK_FINAL.md` with measured results (this is the post-GA follow-up that v1.0.0 owed but did not deliver).
39. Tag `v2.0.0`, write release notes, and publish a v1 → v2 migration guide.

---

## 7. Acceptance chain

```
A → B → C → (parallel: D, E) → F → G → H → I → J → K
```

D and E can run in parallel once C is green (they don't share code paths). F is the integration gate — it cannot start until D and E are both done because the Fastify dashboard and the dispatcher rewrite need the HOLD and approval data models stable.

---

## 8. Risks and spikes

| Risk | Stage | Mitigation |
|---|---|---|
| Claude Dispatch may not support daemon-defined approval events (only Claude's own destructive-action prompts). | D, day 1–2 | Time-boxed spike; on failure, switch the default to `tailscale` (additional ~2 days of UI work that's already scoped). |
| Subscription quota has no official query API. | B step 6 | Use call-count proxy with a clear `subscription_usage` field that is documented as an estimate, not a measurement. |
| Move resume can be inconsistent if a mid-move evidence commit fails. | G step 30 | Wrap the evidence write in a SQLite transaction; cover the failure case in a chaos drill. |
| Linux has no keychain equivalent for `claude` CLI auth. | H | The `claude` CLI stores tokens in `~/.config/claude/` on Linux; this is documented behavior. Stage H acceptance only covers install/start; auth migration lives in the migration guide. |
| Fastify dashboard JSON shape might drift from the Python one and break external readers. | F step 24 | The JSON contract is treated as a stable interface: tests use a shared fixture for both old (during cutover window) and new endpoints. |

---

## 9. Effort estimate

| Stage | Effort |
|---|---|
| A — Foundation | 2 d |
| B — SessionManager + budget | 3 d |
| C — HOLD first-class | 3 d |
| D — ApprovalGateway (with spike) | 5 d |
| E — Push policy | 2 d |
| F — Python collapse + dashboard | 5 d |
| G — Moves | 3 d |
| H — Cross-platform supervisor | 3 d |
| I — Chaos drills | 2 d |
| J — Observability | 2 d |
| K — Release | 3 d |
| Subtotal | **33 d ≈ 6.6 weeks** |
| Plus 1h soak × 10 stages | +1.3 d |
| **Total** | **≈ 7 focused weeks** |

---

## 10. Out of scope (deliberate)

- Multi-tenant / team mode. One daemon, one subscription, one operator. Two users means two installs.
- Linear / Jira / Slack intake. Intake stays at CLI + GitHub webhook.
- Dashboard mutation GUI. Watchdog stays read-only. Operator actions live in the CLI plus the mobile approval channel.
- Distributed runners. Local only.

These four are explicitly deferred. v2.0 must close P1 in full and the P2/P3 items that fit a single-Mac (plus Linux/Docker portability) deployment without inheriting team-mode complexity.

---

## 11. After v2.0 ships

The end state is a single TypeScript daemon, supervised by the host's native init system, that:

- Runs unattended for 24+ hours and recovers from five categories of injected failure.
- Surfaces every blocking state as a HOLD that the operator can resolve from the phone.
- Tracks subscription quota honestly and stops new task starts before the ceiling.
- Enforces a structural rule against pushing forbidden-path changes regardless of how the diff was generated.
- Resumes any long task from the last committed move on restart.
- Exposes the same operational view through CLI, web watchdog, and mobile push.
- Installs the same way on macOS and Linux.

The owner-waived 24h soak from v1.0.0 is replaced by a measured `M22c_SOAK_FINAL.md` in Stage K.
