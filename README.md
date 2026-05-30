# claude-code-247

> Your local-first, multi-repo, 24/7 autonomous coding coworker. The Mac
> stays on; Claude Code authenticated locally drives Docker-isolated
> workers across every repo in your registry, opens draft PRs on GitHub,
> runs external validators, scores risk, and merges low-risk changes
> automatically — gated by your phone if anything bigger.
>
> **v1.0.0 GA shipped 2026-05-25** (with an owner-waived 24h soak gate).
> **v2.2.0-rc2 is the current TypeScript production-grade tag** for this
> single-operator system. Per
> [ADR-0013 Path A](docs/adr/0013-rc-grade-is-prod-grade.md), no `v2.2.0`
> GA tag is created under the current release policy.
>
> **Latest:** `v2.4.0-patch1` — the core value loop has now run **end-to-end on
> real LLM work** for the first time (see the **🆕 v2.4.0-patch1** section just
> below). The architecture has converged to a **TypeScript-only, event-sourced,
> three-plane** design per
> [ADR-0010](docs/adr/0010-three-plane-event-sourced.md); the dual-kernel
> section further down is retained as v1.0.0 history.

## 🆕 v2.4.0-patch1 — real end-to-end loop proven (E2E-Harvest)

The core value loop has now run **end-to-end on real LLM work** for the first
time: a subscription Claude coder running **inside Docker** writes real code →
evidence is collected → two **independent validator families** (OpenAI + Gemini)
judge it on evidence only → a real **draft PR** is opened on GitHub →
token/cost usage is persisted. Architecture decision:
[ADR-0019](docs/adr/0019-real-e2e-loop-docker-claude-dual-family.md).

> Current stage: `ProductionHardened_v2.4_Ready` (see
> [EXECUTION_WORKBOOK.md §0](EXECUTION_WORKBOOK.md)). This is a single-operator
> system; `system.allow_remote_writes` defaults to `false` and gates **every**
> outward write — `git push`, PR creation, and merge alike.

### What's new in the technical surface

- **claude-in-Docker runner** —
  [`packages/runner/src/claude-docker-runner.ts`](packages/runner/src/claude-docker-runner.ts)
  runs the subscription Claude CLI inside a container against a per-task git
  worktree, honoring the image's `/entrypoint.sh` contract (writes
  `/workspace/prompt.txt`; sets `CLAUDE_ROLE` / `CLAUDE_MODEL` /
  `CLAUDE_PERMISSION_MODE` / `CLAUDE_ALLOWED_TOOLS`; reads back
  `/workspace/result.json`). A static + runtime **preflight**
  (`preflightClaudeDockerEnvironment` / `preflightRuntime`) fails fast with a
  `HOLD-CLAUDE-DOCKER-IMAGE` or `HOLD-CLAUDE-AUTH-IN-DOCKER` reason rather than
  ever falling back silently to the paid API.

- **`runner:e2e1` derived image** —
  [`packages/runner/docker/Dockerfile.e2e1`](packages/runner/docker/Dockerfile.e2e1)
  + [`entrypoint-e2e1.sh`](packages/runner/docker/entrypoint-e2e1.sh). The
  patched entrypoint writes `/workspace/cli-envelope.json` (the raw CLI usage
  envelope) **before** normalization, so authoritative token counts survive
  (the stock `result.json` reported `0/0`).

- **Subscription auth via OAuth token** — inject `AEDEV_CLAUDE_OAUTH_TOKEN`
  (from `claude setup-token`) → `CLAUDE_CODE_OAUTH_TOKEN` inside the container.
  The macOS keychain credential is host-bound and **401s inside a Linux
  container**, so the token path is the proven, keychain-free option. All
  `ANTHROPIC_*` paid-API env vars are stripped from the container.

- **`model_usage` accounting + live cost roller** —
  [`insertModelUsage`](packages/core/src/db.ts) persists input/output tokens +
  cost per run and emits a `model.usage.recorded` event. Local subscription
  usage is tracked by run count + cost, never reported as `$0`. The daemon now
  feeds a long-lived [`CostRoller`](packages/cost-meter/src/roller.ts) (seeded
  from `model_usage` on boot so spend survives a restart) and exposes
  `cost_total_usd` / `cost_per_pr_usd_7d` / `cost_event_count` on `/metrics`.
  Only **known** costs are summed — subscription-unknown stays 0, never fabricated.

- **Dual-family validators** — OpenAI- and Gemini-family judges score the
  **evidence package only** (never the coder's conversation or chain-of-thought).
  The merge policy requires two **independent** families to pass.

- **Structured ClarificationGate (ADR-0020)** —
  [`packages/daemon/src/clarification-gate.ts`](packages/daemon/src/clarification-gate.ts)
  scores mission ambiguity deterministically (no LLM, no token spend) over four
  signals; above the threshold (`trigger_threshold: 50` in
  [`config/policies.yaml`](config/policies.yaml)) it asks ≤4 questions **before**
  any coder runs and writes a verifiable `clarified-spec.md`. Decision:
  [ADR-0020](docs/adr/0020-structured-clarification-gate.md).

- **Autonomous draft-PR closure** — the daemon's mission loop now opens a **real
  draft PR** on an `AUTO_MERGE` decision via
  [`DraftPrGate`](packages/daemon/src/draft-pr-gate.ts) over
  `GhGitRemoteWriter` / `GhDraftPrCreator` (runner plane), instead of stopping at
  a mock merge. The gate fail-closes on `allow_remote_writes`, `repo.enabled`,
  and forbidden paths, so the no-push default is preserved — with the flag
  `false` (default) the loop opens nothing. This folds the proven
  [`scripts/e2e1-real-loop.ts`](scripts/e2e1-real-loop.ts) path into the loop.

- **Real-diff forbidden-path gate** — forbidden-path detection reads the runner's
  `changed-paths.json` (the actual `git diff` file list) rather than regexing
  evidence prose, and feeds the merge policy's hard BLOCK
  ([`mission-runner.ts`](packages/daemon/src/mission-runner.ts)).

- **`/github/sync` is gated** — the GitHub PR-sync route now fails closed with
  `REMOTE_WRITES_DISABLED` unless `system.allow_remote_writes` is true (it was
  previously guarded only by the presence of a GitHub token).

### Running the E2E loop

```bash
# 0. One-time: capture a keychain-free subscription token
claude setup-token            # store the sk-ant-oat... value where your secrets live

# 1. Build the runner:e2e1 image (authoritative token counts)
docker build -f packages/runner/docker/Dockerfile.e2e1 \
  -t claude-code-247/runner:e2e1 packages/runner/docker

# 2. Real end-to-end loop: docker Claude coder → dual-family → draft PR → model_usage
#    (draft-only; never merges. Needs the OAuth token + OPENAI/GEMINI keys in env.)
node_modules/.bin/tsx scripts/e2e1-real-loop.ts

# 3. ClarificationGate shadow walk (deterministic; spends no LLM tokens)
node_modules/.bin/tsx scripts/e2e2-clarification-shadow-walk.ts
```

> **Safety model:** these scripts pass `allowRemoteWrites: true` **in-process**
> to a draft-only PR gate; the global `system.allow_remote_writes` stays
> `false`. Because they pre-approve the mission, they deliberately **bypass the
> daemon's approval path** — so no ntfy phone approval is requested. To exercise
> the real approval flow (medium/high-risk merge, API fallback, etc.), run a
> mission through the daemon's `IntakeService`, which pushes an ntfy
> notification to your phone for approve/reject.

## ⚡ Architecture today (v1.0.0) — dual kernel, single product

> The dual-kernel layout below is the **current** state as of v1.0.0 GA.
> v2.0 collapses it to a single TypeScript control plane and removes the
> Python tree entirely. See [V2_ARCHITECTURE.md](docs/archive/V2_ARCHITECTURE.md) for
> the target architecture and the stage-by-stage plan.

`claude-code-247` is one product OS with two cooperating kernels:

| Layer | Implementation | Role |
|---|---|---|
| **Control plane** | **TypeScript `aedev`** (pnpm monorepo) | Primary CLI, daemon, dashboard, state machine, mission intake, roadmap, task graph, approvals, memory, risk, preview/deploy orchestration, evidence bundle. |
| **Execution kernel** | **Python `claude247`** (v1.0.0 GA) | Mature Docker worker runtime, headless `claude --print` invocation, Gemini + OpenAI judges, GitHub PR creation. Invoked by `aedev` during the parity window. |
| **Bridge** | `@aedev/claude247-bridge` | Enqueues tasks into the Python state DB, polls status, imports evidence back into `aedev`'s SQLite. |

This dual-kernel design is recorded in
[ADR-0009](docs/adr/0009-aedev-as-primary-control-plane.md), which supersedes
[ADR-0008](docs/adr/0008-product-spine-python-now-typescript-experimental.md).
`aedev` is the primary entry point for new product-OS work; the Python kernel
continues to drive worker execution and validator orchestration until the
TypeScript runtime reaches parity (see
[`docs/aedev-prototype-status.md`](docs/aedev-prototype-status.md) for the
parity gate list). Both ADRs will be superseded by **ADR-0010** in Stage A of
the v2.0 plan.

## What you get

- **Multi-repo from day one.** One registry, many repos. Per-repo budget,
  risk policy, allowed/forbidden paths.
- **Local-first execution.** Mac + Docker. Your authenticated Claude
  Code session is the default; the paid API is opt-in.
- **Mobile control.** `claude247 status --plain` and `claude247
  status-board --plain` are built for SMS-sized output. ntfy.sh pushes
  for approvals and stuck tasks.
- **External validator isolation.** Gemini 2.5 Pro and an OpenAI-compatible
  judge see only the evidence package — never the Coder's conversation.
- **Low-risk auto-merge** with score 0–100; medium asks your phone, high
  blocks.
- **Long-term memory** that compiles failures, lessons, and decisions
  back into per-repo `.agent/*.md` files.
- **Failure replay** for any task.
- **Live read-only watchdog dashboard** (new in v1.0.0 / M22b) — see
  below.

## Quick start

`aedev` is the primary control plane. The Python `claude247` kernel is
installed alongside it during the parity window and handles worker execution
underneath.

```bash
# 1. Install the Python execution kernel (mature, GA v1.0.0)
make install                    # creates venv + installs deps + launchd plists
claude247 doctor                # verify kernel environment

# 2. Install the TypeScript control plane
pnpm install
pnpm -r build

# 3. Initialize aedev home (~/.aedev/)
aedev init

# 4. Start the aedev daemon (port 7247) — control plane + dashboard
aedev daemon start
open http://localhost:7247

# 5. Submit a mission via the control plane (two-step approval)
aedev intake "refactor the auth middleware in repo my-repo"
aedev mission list              # find the mission id
aedev mission approve <id>      # explicit approval — no self-approve

# 6. Inspect status / tasks via the control plane
aedev status --plain
aedev task list

# 7. Read-only watchdog (Python kernel) — phone-friendly
claude247 status-board --plain
claude247 watchdog --plain
claude247 status-board --json
claude247 status-board --write-md M22_WATCHDOG_DASHBOARD.md
```

During the parity window, some kernel-level operations are still invoked
directly via `claude247` (worker launch, validator orchestration, GitHub
PR creation). The `@aedev/claude247-bridge` package routes `aedev` missions
through the Python kernel automatically — see
[ADR-0009](docs/adr/0009-aedev-as-primary-control-plane.md) and
[`docs/aedev-prototype-status.md`](docs/aedev-prototype-status.md).

## Live watchdog dashboard

A read-only operations dashboard for "is the 24/7 daemon actually OK
right now?" Designed to be safe to run from a phone while the
dispatcher is mid-tick — the SQL is SELECT-only and the contract is
asserted by a regression test
(`tests/unit/test_status_board.py::test_read_only_does_not_mutate_db`).

**Web (Apple-style):** http://127.0.0.1:8423/status-board

- **Activity-ring** soak progress (recolors green / blue / red by
  state) using only inline SVG + CSS — no charting library
- **Auto-refresh** every 15s (configurable 5 / 15 / 30 / 60s / off);
  fetches `/status-board.json`, updates DOM in place, briefly tints
  cards that changed — no full reload, no flicker
- **EN ↔ 中文 language toggle** with `localStorage` persistence
- **Dark mode** follows `prefers-color-scheme`
- **Live indicator dot** in the top bar — pulsing green when live,
  amber when paused, red when a fetch fails
- **Pause / resume / refresh-now** controls with a morphing play/pause
  SVG button
- **Zero external dependencies** — no CDN, no font files, no JS
  library; the whole page is ~25KB inline

**CLI:**

```bash
claude247 status-board --plain
# Claude247 Watchdog Dashboard
# Generated: 2026-05-25T...
#
# Release State / Soak Progress / Runtime Health
# Queue / Task State / Recent Signals / GA Gates / Usage
```

**JSON:** http://127.0.0.1:8423/status-board.json

```json
{
  "generated_at": "...",
  "release_state": { "main_sha": "...", "ga_status": "..." },
  "soak":          { "t0": "...", "progress_percent": 38, "result": "PARTIAL" },
  "runtime_health":{ "launchd_loaded": 4, "dispatcher": "healthy", ... },
  "queue":         { "active_tasks": 0, "orphan_commands": 0, ... },
  "signals":       { "new_critical_errors": 0, "alert_storm": false, ... },
  "ga_gates":      { "passed": 18, "total": 19, "recommendation": "..." },
  "usage":         { "runs_total": 0, "active_workers": 0, ... }
}
```

The watchdog reads `M20_SOAK_RESULT.md` to auto-discover the
dispatcher T0; pass `--t0 2026-05-24T21:46Z` to override.

## Status

- **`v1.0.0` GA — released 2026-05-25** (Python `claude247` kernel).
- The first GA release. See [RELEASE_NOTES_GA.md](RELEASE_NOTES_GA.md)
  for the full notes, [GA_GATE.md](docs/archive/GA_GATE.md) for the 19-gate GA
  contract, and [M22_GA_DECISION_REPORT.md](docs/archive/M22_GA_DECISION_REPORT.md)
  for the GA decision record.
- **Soak gate was explicitly waived by the owner** after ~9h 12m of
  healthy soak evidence (4/4 launchd loaded, ~1182 dispatcher idle
  ticks, backup completed, 0 alerts, 0 orphan commands, $0 Anthropic
  worker spend). Final T+24h observation is a post-GA follow-up —
  the watchdog dashboard will auto-flip `soak.result` to `PASS` or
  `FAIL` once wall-clock crosses `2026-05-25T21:46Z`.
- Pre-release history (`alpha.0` → `beta.2`) preserved on GitHub.
- **`v2.2.0-rc2` is production grade for the TypeScript line** — single
  TypeScript daemon, Python tree removed, HOLD as first-class state,
  closed-loop approval (ntfy/Tailscale), push-time security gate,
  resumable moves, cross-platform supervisor, chaos drills, Agent Mesh,
  RoadmapAgent, and Sentinel. The formal policy is
  [docs/operations/release-policy.md](docs/operations/release-policy.md).
- **No `v2.1.0` or `v2.2.0` GA tag is expected** under the current policy.
  The expected v2 release references are `v2.1.0-rc1`, `v2.1.0-rc2`,
  `v2.2.0-rc1`, and `v2.2.0-rc2`.

## Documentation

**v2 TypeScript line:**

- [**V2_ARCHITECTURE.md**](docs/archive/V2_ARCHITECTURE.md) — full v2.0 architecture and
  stage-by-stage implementation plan (start here)
- [docs/operations/release-policy.md](docs/operations/release-policy.md) —
  current release-grade and tag policy

**v1.0.0 (current GA):**

- [RELEASE_NOTES_GA.md](RELEASE_NOTES_GA.md) — v1.0.0 release notes
- [GA_GATE.md](docs/archive/GA_GATE.md) — 19-gate GA contract + owner-waiver policy
- [M22_GA_DECISION_REPORT.md](docs/archive/M22_GA_DECISION_REPORT.md) — GA decision record
- [M20_SOAK_RESULT.md](docs/archive/M20_SOAK_RESULT.md) — soak observation + waiver record
- [DEFINITION_OF_DONE.md](docs/archive/DEFINITION_OF_DONE.md) — DoD checklist
- [CHANGELOG.md](CHANGELOG.md) — release history
- `docs/ARCHITECTURE.md` — module map and data flow (v1.0.0)
- `docs/INSTALL.md` — full install + uninstall + doctor
- `docs/REMOTE_DISPATCH.md` — phone / Remote / Dispatch operating guide
- `docs/SECURITY.md` — secret hygiene, forbidden paths, approval flow
- `docs/MEMORY.md` — vector + .agent file architecture
- `docs/AUTO_MERGE_POLICY.md` — risk scoring and merge gates
- `docs/VALIDATORS.md` — Gemini + OpenAI judge contracts
- `docs/REPO_ONBOARDING.md` — adding repos
- `docs/OPERATIONS.md` — day-to-day operating playbook

---

## Working on the TypeScript control plane (`aedev`)

```bash
# Install dependencies (Node.js ≥ 20, pnpm ≥ 10 required)
pnpm install

# Run all tests
pnpm test

# Type-check across the workspace
pnpm typecheck

# Lint
pnpm lint

# Opt-in real subprocess smoke tests (require `claude` and/or Docker on PATH)
AEDEV_SMOKE_CLAUDE=1 pnpm test --filter @aedev/runner
AEDEV_SMOKE_DOCKER=1 pnpm test --filter @aedev/runner

# Start the daemon (port 7247) — serves the dashboard + REST API
cd packages/daemon && pnpm start
open http://localhost:7247
```

Architecture decisions for `aedev`: [`docs/adr/`](docs/adr/) (ADR-0001 through ADR-0009).

TS runtime parity gates: [`docs/aedev-prototype-status.md`](docs/aedev-prototype-status.md).

---

## License

Internal.
