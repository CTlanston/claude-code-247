# claude-code-247 Roadmap

**Version target:** v2.4.0 — real vertical slice (ADR-0017)
**Last honest re-plan:** 2026-05-29 (self-dev tick 20260529T131839Z)

The ten-phase "aedev" build plan that bootstrapped this system is preserved
below as the **Historical build plan**. It is design history, not current
state — Phases 0–9 are long since superseded by the v2.1→v2.4 work tracked in
`EXECUTION_WORKBOOK.md §0/§9` and the ADR series (`docs/adr/0010`–`0017`).

---

## Current honest state (verified 2026-05-29)

Grounded in the working tree, ADR-0017, and the §9 session log. Items are only
marked DONE where re-verified this tick or honestly attributed to a prior log.

### DONE (verified this tick)

- **Three-plane runtime is live.** Daemon answers `GET /operator/sessions` on
  `:7247`; Operator Cockpit serves on `:7248`.
- **Workbook end-to-end acceptance 18/18** via `pnpm test:workbook` (mocked
  worker/validators; proves the PLAN→IMPLEMENT→review→risk→merge-decision spine
  end-to-end).

### DONE (per s_0010 session log — not re-run this tick)

- Full suite `pnpm test` 544 passed / 6 skipped; `pnpm typecheck` clean.
- `WorkerPoolRouter` routes dual-validator coder work to `claude-cli`; local
  CLI runner clones a source repo into a per-task worktree, reruns objective
  validate/audit gates, scans forbidden paths, writes model usage, and creates
  a **local-only** commit (no push/PR/merge).

### PARTIAL

- **V2.4 vertical slice S0.** The `scripts/v24-vertical-slice-s0.ts` harness
  exists and passed "to evidence gate" in the s_0010 run, but has **not** been
  run against a healthy local Claude this tick. A full real run is the open gate.
- **Validators.** Gemini/OpenAI are wired evidence-only; real verdicts require
  `AEDEV_GEMINI_API_KEY` / `AEDEV_OPENAI_API_KEY`. Missing keys must be recorded
  as `HOLD-VALIDATOR-KEYS`, not papered over.
- **Cockpit draft-PR path.** Gated `POST .../create-pr` exists but remote writes
  default-blocked; no reviewed real PR adapter/config path yet.

### NOT STARTED

- **P2 durable lease queue** (claim/lease/heartbeat for crash-safe task pickup).
- **Real push / PR / merge** to a target repo. Auto-merge is explicitly out of
  scope for V2.4 (ADR-0017).
- **Real multi-hour local soak** against an actual discovered worker session.

---

## Next 3 priorities (highest value first)

1. **Run `pnpm test:v24:s0` with a healthy local Claude session.** This is the
   §0 `next_action` and the open S0 gate. Record the real result honestly —
   session holds, quota errors, or missing validator keys (`HOLD-VALIDATOR-KEYS`)
   are all valid evidence per ADR-0017, not failures to hide.
2. **Add the P2 durable lease queue** once S0 evidence is reviewed: durable
   claim/lease/heartbeat so a crashed worker's task is re-leased, not lost.
3. **Design the gated draft-PR path for the real target repo.** Requires
   `allow_remote_writes=true` + enabled repo + explicit operator approval and a
   reviewed PR adapter. Keep it behind the gate; do not enable merge.

---

## Historical build plan (Phases 0–9)

> Superseded design history from the initial 2026-05-25 build plan. Retained
> for reference; current state is the section above.

---

## Phase 0 — Design Foundation

**Goal:** Produce all architecture documents, ADRs, and the operating model
before writing a single line of TypeScript. Engineers joining at Phase 1 should
be able to read these documents and understand the full system.

### Acceptance Criteria

- [ ] `docs/architecture.md` — five planes, module map, agent roles, evidence
      bundle spec, invariants, technology stack
- [ ] `docs/roadmap.md` — this file; all ten phases with criteria and file lists
- [ ] `docs/operating-model.md` — mission/task lifecycles, human gates,
      hold-on-blocker protocol, CLI command reference
- [ ] `docs/security-model.md` — secret isolation, grant model, risk scoring,
      merge policy, validator isolation, approval requirements
- [ ] `docs/adr/0001-local-first-daemon.md` through `0007-secret-grant-policy.md`
- [ ] No TypeScript, no package.json, no pnpm-workspace.yaml created yet
- [ ] No Python source files modified

### Files Created

```
docs/architecture.md
docs/roadmap.md
docs/operating-model.md
docs/security-model.md
docs/adr/0001-local-first-daemon.md
docs/adr/0002-typescript-node.md
docs/adr/0003-sqlite-plus-file-evidence.md
docs/adr/0004-docker-worker-sandbox.md
docs/adr/0005-github-as-audit-surface.md
docs/adr/0006-dual-validator.md
docs/adr/0007-secret-grant-policy.md
```

---

## Phase 1 — TypeScript Workspace

**Goal:** Create the pnpm monorepo skeleton with all packages and apps
scaffolded, tooling configured, and CI passing on an empty test suite.

### Acceptance Criteria

- [ ] `pnpm-workspace.yaml` defines all packages and apps
- [ ] All packages have `package.json` with correct `name`, `version`, `main`,
      `types` fields
- [ ] Root `tsconfig.json` with `strict: true`; each package extends it
- [ ] ESLint 9 + typescript-eslint + Prettier configured; `pnpm lint` exits 0
- [ ] Vitest configured; `pnpm test` exits 0 (no tests yet, zero failures)
- [ ] `packages/core` exports: `Id` (ULID), `Logger`, `Config` type stubs
- [ ] All other packages export a single placeholder `export {}`
- [ ] `apps/dashboard` has `vite.config.ts` and `index.html`; `pnpm build`
      exits 0 (no React components yet)

### Files Created

```
pnpm-workspace.yaml
package.json                    (root, scripts: lint / test / build)
tsconfig.json                   (root, base)
.eslintrc.cjs                   (root, ESLint 9 flat config)
.prettierrc
vitest.config.ts                (root workspace config)
packages/core/package.json
packages/core/tsconfig.json
packages/core/src/index.ts
packages/cli/package.json
packages/cli/tsconfig.json
packages/cli/src/index.ts
packages/daemon/package.json
packages/daemon/tsconfig.json
packages/daemon/src/index.ts
packages/runner/package.json
packages/runner/tsconfig.json
packages/runner/src/index.ts
packages/github/package.json
packages/github/tsconfig.json
packages/github/src/index.ts
packages/validators/package.json
packages/validators/tsconfig.json
packages/validators/src/index.ts
packages/secrets/package.json
packages/secrets/tsconfig.json
packages/secrets/src/index.ts
apps/dashboard/package.json
apps/dashboard/tsconfig.json
apps/dashboard/vite.config.ts
apps/dashboard/index.html
apps/dashboard/src/main.tsx
```

---

## Phase 2 — State Kernel

**Goal:** Implement the SQLite schema, all migrations, the repo registry loader,
and the task lifecycle state machine. All state transitions are tested.

### Acceptance Criteria

- [ ] `packages/core/src/schema.sql` defines all twelve tables with indexes and
      foreign keys
- [ ] Migration runner applies schema to a fresh `~/.aedev/state.db`
- [ ] `RepoRegistry` loads `repos.yaml`, validates required fields, writes to
      `repos` table, and watches for file changes
- [ ] `StateMachine` enforces legal mission transitions:
      `draft → pending_approval → approved → running → done|failed|cancelled|paused`
- [ ] `StateMachine` enforces legal task transitions:
      `pending → running → done|failed|cancelled|hold`
- [ ] Illegal transition throws a typed `StateMachineError` (not a generic
      `Error`)
- [ ] `packages/daemon/src/state/` has unit tests for every legal and illegal
      transition; `pnpm test` passes

### Files Created

```
packages/core/src/schema.sql
packages/core/src/db.ts          (better-sqlite3 connection factory)
packages/core/src/migrations.ts  (applies schema.sql, version table)
packages/core/src/types.ts       (all DB row types, enums for status fields)
packages/daemon/src/state/
  repo-registry.ts
  state-machine.ts
  state-machine.test.ts
  repo-registry.test.ts
```

---

## Phase 3 — CLI and Daemon

**Goal:** `aedev` CLI binary is installable and talks to a running Fastify
daemon. The daemon starts, responds to health checks, and shuts down cleanly.

### Acceptance Criteria

- [ ] `pnpm --filter @aedev/cli build` produces a runnable `dist/aedev` binary
- [ ] `aedev daemon start` spawns the daemon process, waits for its
      `/api/health` to return 200, then prints `daemon started (pid <n>)`
- [ ] `aedev daemon stop` sends SIGTERM to the daemon, waits for clean exit,
      prints `daemon stopped`
- [ ] `aedev daemon status` prints running/stopped and PID when running
- [ ] `aedev status` hits `/api/status` and prints a text summary
- [ ] Daemon writes a heartbeat row to `events` table every 30 seconds
- [ ] launchd plist template is generated at install time (Phase 3 only
      generates it; Phase 9 wires it to auto-start)
- [ ] `pnpm test` passes for daemon and CLI packages

### Files Created

```
packages/cli/src/
  bin.ts                   (entry point, shebang)
  commands/
    daemon.ts              (start / stop / restart / status)
    status.ts
packages/daemon/src/
  server.ts                (Fastify app factory)
  routes/
    health.ts
    status.ts
  heartbeat.ts
  pid-file.ts              (write/read/clear PID file in ~/.aedev/)
scripts/
  generate-launchd-plist.ts
```

---

## Phase 4 — Intake, PRD, ADR, Roadmap

**Goal:** `aedev intake "<requirement>"` triggers the Lead agent flow:
requirement clarification, PRD generation, ADR generation (if needed), and
roadmap generation. All outputs require human approval before a mission is
created.

### Acceptance Criteria

- [ ] `aedev intake "description"` creates a `mission` record in state
      `draft`, writes a clarification prompt to stdout, waits for response
- [ ] After clarification, the Lead agent (Claude Code CLI subprocess) produces
      `~/.aedev/prd/<mission_id>.md`
- [ ] If the intake involves a new architectural decision, it also produces
      `~/.aedev/adr/<slug>.md`
- [ ] `aedev mission view <id>` shows the PRD and current state
- [ ] `aedev mission approve <id>` transitions mission to `pending_approval`;
      records approval in `approvals` table
- [ ] After PRD approval, Lead agent produces `~/.aedev/roadmaps/<mission_id>.md`
- [ ] `aedev mission roadmap-approve <id>` transitions to `approved`
- [ ] No tasks are created or workers spawned until roadmap is approved
- [ ] `pnpm test` passes for Lead agent prompt builder and intake flow

### Files Created

```
packages/daemon/src/
  agents/
    lead-agent.ts          (Claude Code subprocess wrapper for Lead role)
    lead-prompts.ts        (PRD / ADR / roadmap prompt templates)
  intake/
    intake-handler.ts
    prd-writer.ts
    adr-writer.ts
    roadmap-writer.ts
packages/cli/src/commands/
  intake.ts
  mission.ts               (list / view / approve / roadmap-approve / cancel)
```

---

## Phase 5 — Docker Worker Runner

**Goal:** Workers run real tasks in Docker containers. The evidence bundle is
written correctly. Retry and replay work.

### Acceptance Criteria

- [ ] `packages/runner` can start a Docker container for a given task, mount
      the worktree and output directory, and wait for completion
- [ ] Worker writes all nine evidence bundle files to the output directory
- [ ] If the worker exits non-zero, the daemon marks the run as `failed` and
      (if retry count < max) creates a new `run` record and retries
- [ ] Retry limit is configurable per repo in `repos.yaml` (default: 3)
- [ ] `aedev task replay <task_id>` re-runs the most recent failed run from its
      evidence bundle (useful for diagnosing failures without re-running the
      full worker)
- [ ] Worktrees are created in `~/.aedev/evidence/<task_id>/worktree/` and
      cleaned up after task completion (or preserved on failure for inspection)
- [ ] Secret grants are read from `secret_grants` table; expired grants are
      rejected before container launch
- [ ] Integration test: run a real `echo "hello"` worker against a fixture repo;
      verify evidence bundle is complete

### Files Created

```
packages/runner/src/
  docker-manager.ts        (container lifecycle: create / start / wait / remove)
  worktree-manager.ts      (git worktree create / clean up)
  claude-adapter.ts        (builds claude CLI invocation for the worker)
  evidence-writer.ts       (writes evidence bundle files from worker output)
  retry-controller.ts      (retry loop, backoff, max-attempts enforcement)
  replay-controller.ts     (replay from evidence bundle)
  runner.test.ts           (integration test with fixture repo)
packages/runner/docker/
  Dockerfile               (Node 20 + git + gh + claude CLI)
  entrypoint.sh
  worker-bootstrap.ts      (reads task spec, runs Claude, writes evidence)
```

---

## Phase 6 — Review, Validation, Risk

**Goal:** After a worker completes, the Reviewer agent assesses the evidence
bundle, both external validators run, and the risk scorer produces a 0–100
score with a merge policy decision.

### Acceptance Criteria

- [ ] Reviewer agent runs as a Claude Code subprocess, receives only the
      evidence bundle (no worker transcript), and writes a structured review
      to `evidence/<task_id>/review.md`
- [ ] Gemini judge adapter calls the Gemini API with the evidence bundle and
      produces `validator-gemini.json` with `verdict: pass|fail|error` and
      `reasoning: string`
- [ ] OpenAI judge adapter does the same for `validator-openai.json`
- [ ] Risk scorer reads the diff stats and evidence bundle and produces
      `risk-report.json` with `score: number` and `factors: Factor[]`
- [ ] Merge policy applies:
  - Score 0–29, both validators pass → `AUTO_MERGE`
  - Score 30–59, or one validator warning → `WAITING` (human approval required)
  - Score 60–100, or either validator fails → `BLOCKED`
  - Validator disagreement → `WAITING` regardless of score
- [ ] `pnpm test` passes for risk scorer (unit tests for each factor), merge
      policy (all decision paths), and validator adapters (mocked HTTP)

### Files Created

```
packages/daemon/src/agents/
  reviewer-agent.ts
  reviewer-prompts.ts
packages/validators/src/
  gemini-judge.ts
  openai-judge.ts
  validation-policy.ts     (dual-validator agreement logic)
  judge-contract.ts        (shared TypeScript types for verdict)
  gemini-judge.test.ts
  openai-judge.test.ts
  validation-policy.test.ts
packages/daemon/src/risk/
  risk-scorer.ts
  merge-policy.ts
  risk-scorer.test.ts
  merge-policy.test.ts
```

---

## Phase 7 — GitHub Collaboration Surface

**Goal:** Tasks create branches and PRs on GitHub. PR status reflects task
state. Evidence summary is posted as a PR comment.

### Acceptance Criteria

- [ ] `packages/github` wraps Octokit; all GitHub calls are gated on
      `allow_remote_writes: true` AND `repo.enabled: true`
- [ ] When a task moves to `done`, the runner pushes the worktree branch to
      GitHub and creates a PR with: mission title, task description, risk score,
      merge policy decision
- [ ] Check status on the PR is updated at each state transition (pending /
      running / success / failure)
- [ ] Evidence summary (truncated to GitHub comment size limits) is posted as a
      collapsible comment on the PR
- [ ] `aedev task approve <task_id>` approves a `WAITING` task; daemon then
      triggers the PR merge
- [ ] `packages/github` has unit tests for branch naming, PR body generation,
      and evidence comment formatting (all using mocked Octokit)

### Files Created

```
packages/github/src/
  github-client.ts         (Octokit factory, write-gate enforcement)
  branch-manager.ts        (branch naming, push)
  pr-manager.ts            (create PR, update body, merge)
  check-sync.ts            (create/update check runs)
  evidence-comment.ts      (format + post evidence summary comment)
  issue-importer.ts        (import GitHub issues as mission drafts)
  github-client.test.ts
  pr-manager.test.ts
  evidence-comment.test.ts
packages/cli/src/commands/
  task.ts                  (list / view / approve / retry / replay)
```

---

## Phase 8 — Dashboard

**Goal:** The web dashboard provides a full operational view of the system with
live updates via SSE.

### Acceptance Criteria

- [ ] Dashboard SPA loads at `http://localhost:<port>/` within 2 seconds on
      first load
- [ ] Roadmap view: shows missions with status badges and progress indicators
- [ ] Task timeline: shows tasks in chronological order with state, risk score,
      merge policy
- [ ] Approvals queue: shows all `WAITING` items with Approve / Reject buttons
      that call the daemon API
- [ ] Risk board: shows `BLOCKED` tasks with their risk score breakdown
- [ ] ADR browser: reads ADR files from `~/.aedev/adr/` and renders them
- [ ] Memory browser: shows per-repo memory items by category
- [ ] All live data updates via SSE (no polling)
- [ ] `pnpm build` produces a static bundle under `apps/dashboard/dist/`
      served by the daemon

### Files Created

```
apps/dashboard/src/
  App.tsx
  hooks/
    useSSE.ts              (SSE connection to /events)
    useApi.ts              (typed fetch wrapper)
  views/
    RoadmapView.tsx
    TaskTimelineView.tsx
    ApprovalsView.tsx
    RiskBoardView.tsx
    AdrBrowserView.tsx
    MemoryBrowserView.tsx
  components/
    StatusBadge.tsx
    RiskMeter.tsx
    EvidencePanel.tsx
    ApprovalCard.tsx
  types/
    api.ts                 (mirrors packages/core types for dashboard use)
```

---

## Phase 9 — Memory Compiler

**Goal:** After each task completes, the memory compiler updates per-repo
memory: decisions made, failures encountered, user preferences observed, and
repo conventions discovered. Memory is injected into future worker prompts.

### Acceptance Criteria

- [ ] After task `done`, memory compiler reads `done-report.md` and
      `transcript-summary.md` and extracts: decisions (why X was chosen over Y),
      failures (what failed and how it was fixed), conventions (patterns
      observed in the repo)
- [ ] Extracted items are written to `memory_items` table and
      `~/.aedev/memory/<repo_slug>/`
- [ ] Worker builder reads relevant memory items (top-10 by recency and
      relevance score) and injects them into the Builder prompt as a
      "Prior context from this repo" section
- [ ] `aedev memory list <repo>` shows all memory items for a repo
- [ ] `aedev memory clear <repo>` clears all memory items for a repo (with
      confirmation prompt)
- [ ] launchd plist is registered at system install time; daemon auto-starts
      on login and restarts on crash
- [ ] `aedev doctor` checks: Docker running, Claude CLI authenticated, GitHub
      auth valid, SQLite writable, launchd plist loaded
- [ ] `pnpm test` passes for memory compiler extraction and prompt injection

### Files Created

```
packages/daemon/src/memory/
  memory-compiler.ts       (post-task extraction pipeline)
  memory-injector.ts       (selects and formats memory for prompt injection)
  memory-compiler.test.ts
packages/cli/src/commands/
  memory.ts                (list / clear)
  doctor.ts
scripts/
  install.ts               (registers launchd plist, creates ~/.aedev/)
  uninstall.ts
  doctor.ts
```

---

## Phase Summary Table

| Phase | Name | Key Output |
|---|---|---|
| 0 | Design Foundation | All docs and ADRs |
| 1 | TypeScript Workspace | pnpm monorepo, tooling, passing CI |
| 2 | State Kernel | SQLite schema, state machine, repo registry |
| 3 | CLI and Daemon | `aedev daemon start/stop`, heartbeat, launchd template |
| 4 | Intake, PRD, ADR, Roadmap | Lead agent, PRD/ADR/roadmap flow, approval gate |
| 5 | Docker Worker Runner | Real tasks in Docker, evidence bundles, retry/replay |
| 6 | Review, Validation, Risk | Reviewer, Gemini/OpenAI validators, risk scorer, merge policy |
| 7 | GitHub Collaboration Surface | Branch + PR + checks + evidence comment |
| 8 | Dashboard | Vite + React SPA with live SSE updates |
| 9 | Memory Compiler | Per-repo memory, prompt injection, launchd auto-start |
