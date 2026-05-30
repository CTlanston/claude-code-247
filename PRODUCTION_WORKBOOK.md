# PRODUCTION_WORKBOOK · Claude Code 247

> Canonical production-hardening workbook for the current v24 repository.
> Read this after `AGENTS.md` and `EXECUTION_WORKBOOK.md §0` before any write.
> Do one stage or one named slice per run, then update this file and
> `docs/handoff/production-handoff-latest.md`.

---

## §0 · STATE

```yaml
schema_version: 1
version_target: production-usable-24x7
canonical_repo: /Users/lanston/projects/claude-code-247
canonical_branch_family: codex/v24-vertical-slice
design_adr: docs/adr/0018-production-hardening-loop.md
latest_handoff: docs/handoff/production-handoff-latest.md
current_stage: E2E-2_CLARIFICATION_GATE_L3_PENDING
last_updated_utc: 2026-05-30T07:10:50Z
last_session_id: s_0036
open_holds: 0
blocked_on: none
next_action: |
  Reconciled after local harvest commit 1dbc2e5 landed on codex/v24-vertical-slice.
  E2E-1 is now recorded as proven by committed evidence: real Claude-in-Docker
  work, model_usage, dual-family validator evidence, and draft-only PR proofs for
  CTlanston/multi-agent-brainstorm PR #12/#13. E2E-2 structured clarification
  gate (ADR-0020) is built and green locally, with deterministic ambiguity
  scoring, <=4 option-style questions, mission.clarification events, and
  clarified-spec.md rendering. Current safe next action: operator/L2 review the
  harvest commit and run the E2E-2 L3 cockpit multi-round clarification walk.
  Do not mark production-ready, merge target PR #12/#13, or start ADR-0021
  pre-research until that review/walk is complete. Remote writes remain globally
  disabled (`allow_remote_writes=false`); gh auth is still invalid in this run,
  so no PR read/write verification was performed.
active_automations:
  - id: claude-code-247-v2-3-autonomous-continuation
    name: Claude Code 247 production hardening loop
    status: ACTIVE
    cwd: /Users/lanston/projects/claude-code-247
  - id: commentpilot-247-autonomous-iteration-guard
    name: CommentPilot 247 autonomous iteration guard
    status: ACTIVE
    cwd: /Users/lanston/projects/commentpilot-247
paused_automations:
  - v2-3-mission-os-continuation
  - claude-247
  - hermus-obsidian-daily-brief
```

---

## §1 · Operating Contract

- Current v24 repo is the only Claude Code 247 implementation target.
- Work exactly one stage/slice per run; never mix unrelated production stages in
  one commit.
- Never edit `.env*`, `secrets/**`, SSH/keychain files, production
  credentials, `.github/**`, or `AGENTS.md`.
- Preserve user changes. Classify dirty files before writing; do not delete or
  revert unowned work.
- Remote writes require all three gates: `system.allow_remote_writes=true`,
  repo `enabled=true`, and explicit authorization in the current stage.
- Daemon code may coordinate policy/state, but subprocess side effects must
  stay in worker or side-effect packages.
- Validators see evidence only. Missing validators are `not_configured`, never
  silent PASS.
- End each run with updated workbook state, latest handoff, validation results,
  evidence paths, and the next exact action.

---

## §2 · Stage Queue

### P0_CONSOLIDATE_AUTOMATION_AND_HYGIENE

**Goal:** one canonical repo, one main automation, one handoff surface, no raw
runtime churn in source status.

**Status:** accepted in `s_0011`.

**Acceptance:**
- Only the main Claude Code 247 cron and CommentPilot guard are ACTIVE.
- v2.3 duplicate automations and current-thread heartbeat are PAUSED.
- Raw `roadmap-agent-tick-*` files and local self-dev launchd prototypes are
  ignored; rollup evidence preserves the signal.
- Latest handoff exists at `docs/handoff/production-handoff-latest.md`.

**Evidence:** `evidence/launch/roadmap-agent-rollup-2026-05-29.md`.

**Validation:** `bash scripts/doctor.sh`, `pnpm lint`, `pnpm typecheck`, and
`pnpm test` all passed on 2026-05-29.

### P1_BOUNDARY_LINT

**Goal:** restore lintability and enforce the three-plane boundary before more
features are added.

**Status:** accepted in `s_0011`.

**Acceptance:**
- `pnpm lint` does not scan runtime state/worktrees.
- `packages/daemon/src/**` has no direct `child_process` import.
- Real `git push` / `gh pr create` adapters live in the runner/side-effect
  plane and remain unit tested with injected exec functions.
- Baseline gates pass: `bash scripts/doctor.sh`, `pnpm lint`,
  `pnpm typecheck`, `pnpm test`.

**HOLD if:** lint fails on a real product issue outside P1 scope; do not paper
over it with broad ignores.

**Validation:** `pnpm lint` passed after ignoring runtime state/worktrees and
moving GitHub remote-write adapters into `@aedev/runner`; `pnpm typecheck` and
`pnpm test` passed.

### P2_COCKPIT_DRAFT_PR_REAL_PATH

**Goal:** remove fake Operator Cockpit PR adapters from the production route.

**Status:** route contract implemented in `s_0012`; `s_0013` precheck found
the live disposable-repo smoke blocked on missing remote-write config/registry
and invalid GitHub CLI auth. `s_0014` resolved the unrelated `approval-v2`
tamper-token baseline regression. `s_0016` rechecked the P2 gate/auth hold and
confirmed it remains blocked while the baseline suite stays green. `s_0017`
rechecked the same hold; gate/auth still blocks the live smoke, and a
restricted-network `pnpm install` attempt left local tooling incomplete until
dependencies are restored. `s_0018` rechecked both open holds; gate/auth is
still missing, local test binaries are still absent, and offline dependency
restore is still blocked by a missing `@eslint/js@9.39.4` tarball. `s_0019`
rechecked both open holds; gate/auth is still missing, local test binaries are
still absent, and offline dependency restore is still blocked by missing store
tarballs including `@eslint-community/regexpp@4.12.2`. `s_0020` rechecked both
open holds; gate/auth is still missing, local test binaries are still absent,
and offline dependency restore is still blocked by a missing `ms@2.1.3`
tarball. `s_0021` rechecked both open holds; gate/auth is still missing,
local test binaries are still absent, and offline dependency restore is still
blocked by a missing `eslint@9.39.4` tarball. `s_0022` rechecked both open
holds; gate/auth is still missing, local test binaries are still absent, and
offline dependency restore is still blocked by a missing
`@eslint-community/eslint-utils@4.9.1` tarball. `s_0023` rechecked both open
holds; gate/auth is still missing, local test binaries are still absent, and
offline dependency restore is still blocked by a missing
`@eslint-community/regexpp@4.12.2` tarball. `s_0024` rechecked both open holds;
gate/auth is still missing, local test binaries are still absent, and offline
dependency restore is still blocked by a missing `@eslint/js@9.39.4` tarball.
`s_0025` rechecked both open holds; gate/auth is still missing, local test
binaries are still absent, and offline dependency restore is still blocked by a
missing `@eslint/js@9.39.4` tarball. `s_0026` rechecked both open holds;
gate/auth is still missing, local test binaries are still absent, and offline
dependency restore is still blocked by a missing
`@eslint-community/eslint-utils@4.9.1` tarball. `s_0027` rechecked both open
holds; gate/auth is still missing, local test binaries are still absent, and
offline dependency restore is still blocked by a missing
`@eslint/config-array@0.21.2` tarball. `s_0028` rechecked both open holds under
E2E-0; gate/auth was still missing, local test binaries were still absent,
offline restore was blocked by a missing `eslint@9.39.4` tarball, and frozen
online install was blocked by sandbox DNS/network failure to `registry.npmjs.org`.
`s_0029` completed E2E-0: dependencies were restored, the full baseline passed,
canonical `~/.claude-code-247` config/repos were verified, `gh` auth was valid,
the target repo was registered enabled with auto-merge disabled, and the
disposable P3 draft-PR smoke passed without merging.

**Acceptance:**
- `/operator/sessions/:id/create-pr` never returns `example.invalid`.
- Remote writes disabled -> `REMOTE_WRITES_DISABLED`, no executor called.
- Executor unavailable -> clear blocked result/HOLD, not fake success.
- Remote-write executor uses idempotency and runs outside daemon subprocess
  ownership.
- Disposable-repo smoke proves branch push + draft PR + idempotent reuse; no
  merge.

**Evidence:**
- `evidence/production/p2-route-contract-2026-05-29.md`
- `evidence/production/p2-live-smoke-blocked-2026-05-29.md`
- `evidence/production/approval-v2-tamper-hold-resolved-2026-05-29.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0015.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0016.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0017.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0018.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0019.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0020.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0021.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0022.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0023.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0024.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0025.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0026.md`
- `evidence/production/p2-live-smoke-hold-recheck-2026-05-29-s0027.md`
- `evidence/e2e/s0-unblock/hold-recheck-2026-05-29-s0028.md`
- `evidence/e2e/s0-unblock/pnpm-install.log`
- `evidence/e2e/s0-unblock/typecheck.log`
- `evidence/e2e/s0-unblock/lint.log`
- `evidence/e2e/s0-unblock/test.log`
- `evidence/e2e/s0-unblock/gh-auth-status.txt`
- `evidence/e2e/s0-unblock/p3-remote-smoke.log`
- `evidence/launch/operator-cockpit-p3-remote-smoke-2026-05-29T22-31-59-325Z.md`

**Validation so far:** `bash scripts/doctor.sh`, `pnpm lint`,
`pnpm typecheck`, focused draft-PR route/gate tests, focused approval-v2 tests,
and `pnpm test` passed on 2026-05-29. Latest full result from `s_0016`: 93
test files passed; 554 tests passed, 6 skipped. Boundary check
`rg "child_process" packages/daemon/src` also passed with no matches. In
`s_0017`, `bash scripts/doctor.sh` and the daemon boundary check still passed,
but `pnpm lint`, `pnpm typecheck`, `pnpm test`, and the P3 smoke command failed
before useful validation because local CLI tools (`eslint`, `tsc`, `vitest`,
`tsx`) were unavailable after a network-blocked dependency install. In
`s_0018`, `bash scripts/doctor.sh` and the daemon boundary check still passed,
but offline restore failed because the local pnpm store is missing
`@eslint/js@9.39.4`; `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm test:cockpit:p3-remote-smoke` still fail before product validation because
the same local binaries are missing. In `s_0019`, `bash scripts/doctor.sh` and
the daemon boundary check still passed, but offline restore failed because the
local pnpm store is missing `@eslint-community/regexpp@4.12.2`; `pnpm lint`,
`pnpm typecheck`, `pnpm test`, and `pnpm test:cockpit:p3-remote-smoke` still
fail before product validation because the same local binaries are missing.
In `s_0020`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store is missing
`ms@2.1.3`; `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm test:cockpit:p3-remote-smoke` still fail before product validation
because the same local binaries are missing.
In `s_0021`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store is missing
`eslint@9.39.4`; `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm test:cockpit:p3-remote-smoke` still fail before product validation
because the same local binaries are missing.
In `s_0022`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store is missing
`@eslint-community/eslint-utils@4.9.1`; `pnpm lint`, `pnpm typecheck`,
`pnpm test`, and `pnpm test:cockpit:p3-remote-smoke` still fail before product
validation because the same local binaries are missing.
In `s_0023`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store is missing
`@eslint-community/regexpp@4.12.2`; `pnpm lint`, `pnpm typecheck`, `pnpm test`,
and `pnpm test:cockpit:p3-remote-smoke` still fail before product validation
because the same local binaries are missing.
In `s_0024`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store is missing
`@eslint/js@9.39.4`; `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm test:cockpit:p3-remote-smoke` still fail before product validation
because the same local binaries are missing.
In `s_0025`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store is missing
`@eslint/js@9.39.4`; `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm test:cockpit:p3-remote-smoke` still fail before product validation
because the same local binaries are missing.
In `s_0026`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store is missing
`@eslint-community/eslint-utils@4.9.1`; `pnpm lint`, `pnpm typecheck`,
`pnpm test`, and `pnpm test:cockpit:p3-remote-smoke` still fail before product
validation because the same local binaries are missing.
In `s_0027`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store is missing
`@eslint/config-array@0.21.2`; `pnpm lint`, `pnpm typecheck`, `pnpm test`, and
`pnpm test:cockpit:p3-remote-smoke` still fail before product validation
because the same local binaries are missing.
In `s_0028`, `bash scripts/doctor.sh` and the daemon boundary check still
passed, but offline restore failed because the local pnpm store was missing
`eslint@9.39.4`; frozen online install also failed because the sandbox could
not resolve `registry.npmjs.org`; `pnpm lint`, `pnpm typecheck`, `pnpm test`,
and `pnpm test:cockpit:p3-remote-smoke` failed before product validation
because the same local binaries were missing. In `s_0029`,
`pnpm install --frozen-lockfile`, `pnpm typecheck`, `pnpm lint`, `pnpm test`
(93 files, 554 passed, 6 env-gated smoke skips), `gh auth status`, and
`pnpm test:cockpit:p3-remote-smoke` all passed.

**Remaining:** E2E-1/E2E-2 harvest evidence was merged locally in `1dbc2e5`.
The production workbook had still pointed at the older `s_0035` hold state;
`s_0036` reconciles that contradiction without product-code changes. The next
operator-owned gate is E2E-2 L3: perform a real cockpit multi-round
clarification walk and review the harvest commit before any production-ready
claim or ADR-0021 pre-research stage.

### E2E-0_UNBLOCK_AND_BASELINE_GREEN

**Goal:** clear the dependency and gate/auth holds before starting the real E2E
loop.

**Status:** accepted in `s_0029`; handoff reconciled in `s_0030`.

**Acceptance:**
- `pnpm install --frozen-lockfile` passed with unchanged package and lock files.
- `pnpm typecheck`, `pnpm lint`, and `pnpm test` passed.
- `gh auth status` is valid as `CTlanston`.
- `~/.claude-code-247/config.yaml` and `repos.yaml` exist; target repo
  `CTlanston/multi-agent-brainstorm` is enabled; `allow_remote_writes=false`.
- Disposable P3 remote-write smoke created/reused a draft PR and confirmed
  `mergedAt=null`.

**Evidence:** `evidence/e2e/s0-unblock/` and
`evidence/launch/operator-cockpit-p3-remote-smoke-2026-05-29T22-31-59-325Z.md`.

### E2E-1_REAL_LOOP_ADR_AND_PRECHECK

**Goal:** connect and prove one real loop on `CTlanston/multi-agent-brainstorm`:
Dockerized subscription-Claude coder, real OpenAI+Gemini dual-family
validation, persisted `model_usage`, and a live draft-only PR.

**Status:** accepted by committed local harvest `1dbc2e5`. ADR-0019 is
written; `model_usage` persistence exists; the `claude-docker` runner seam,
default OpenAI+Gemini validator factory, Docker preflight path, and hardened
real-token runner evidence are present. The committed evidence records PR #12
as the first real draft-only proof and PR #13 as the hardened decisive
dual-family proof. Both target PRs remain draft-only proof artifacts and must
not be merged as part of this repo's production hardening.

**Latest evidence:**
- `evidence/e2e/s1/e2e1-real-loop-report.md`
- `evidence/e2e/s1/HOLD-CLAUDE-AUTH-IN-DOCKER.md`
- `evidence/e2e/s1/proof/pr12-gh-verified.json`
- `evidence/e2e/s1/proof/pr12.diff`
- `evidence/e2e/s1/proof/pr13-gh-verified.json`
- `evidence/e2e/s1/proof/db-audit.txt`
- `evidence/e2e/s1/proof/validators-run11.txt`
- `evidence/e2e/s1/claude-docker-runner-prelive-2026-05-29-s0031.md`
- `evidence/e2e/s1/validator-factory-prelive-2026-05-29-s0032.md`
- `evidence/e2e/s1/claude-docker-preflight-2026-05-30-s0033.md`
- `evidence/e2e/s1/live-checkpoint-hold-2026-05-30-s0034.md`
- `evidence/e2e/s1/live-checkpoint-hold-recheck-2026-05-30-s0035.md`

**Acceptance:** see `EXECUTION_WORKBOOK.md` Stage E2E-1 and
`docs/handoff/e2e-real-loop-plan-and-prompt.md`.

### E2E-2_CLARIFICATION_GATE_L3_PENDING

**Goal:** gate ambiguous missions before coder execution by asking structured
operator questions and rendering a verifiable clarified spec.

**Status:** built and locally green in harvest commit `1dbc2e5`; L3 operator
walk pending. ADR-0020 is accepted. `ClarificationGate` uses deterministic
signals and policy weights, emits `mission.clarification.{requested,answered,
resolved}` events, writes `clarified-spec.md`, and is wired into intake as an
injectable opt-in so default behavior remains unchanged.

**Latest evidence:**
- `docs/adr/0020-structured-clarification-gate.md`
- `evidence/e2e/s2/shadow-walk.log`
- `packages/daemon/src/clarification-gate.test.ts`
- `packages/daemon/src/intake-clarification.test.ts`

**Acceptance:** see `EXECUTION_WORKBOOK.md` Stage E2E-2. L1 is recorded as
green (clarification-gate 11/11, intake-clarification 3/3, full suite 586
passed/6 skipped in the harvested evidence). L3 remains pending: operator must
walk a real multi-round clarification in the cockpit.

### P3_SECRETS_GRANT_SERVICE

**Goal:** make the CLI secrets commands point at a real grant lifecycle.

**Acceptance:**
- Daemon exposes grant/list/revoke routes matching the CLI.
- Grants include TTL/status/audit metadata and never log plaintext secret
  values.
- Expired or revoked grants are rejected by worker injection paths.
- Unit tests cover grant, list, revoke, expiry, and log redaction.

### P4_DOCS_CONFIG_STATUS_DRIFT

**Goal:** align user-facing docs, config, CLI doctor, status API, and version
language with the TS daemon on port 7247 and the v24 production-hardening line.

**Status:** partially done in `s_0011` for default port, CLI doctor health
probe, and `/status` Mission OS version. Full docs sweep remains.

**Acceptance:**
- `config/default.yaml` and docs agree on `127.0.0.1:7247`.
- CLI doctor probes `/health`, not stale `/healthz`.
- `/status` reports the current Mission OS line honestly.
- Stale `8423` references are either removed, marked archive-only, or explained
  as historical.

### P5_LAUNCHD_SOAK_EVIDENCE

**Goal:** prove real-clock unattended operation under launchd.

**Acceptance:**
- launchd install -> daemon green -> doctor green -> uninstall clean.
- A 24h soak records heartbeat, uptime, holds, task outcomes, validator state,
  and recovery behavior.
- 72h soak is required before any GA/production-ready claim.

### P6_AUTOMATION_GOVERNANCE_AND_HANDOFF

**Goal:** keep autonomous continuation aligned after the code is production
ready enough to run unattended.

**Acceptance:**
- Main automation prompt remains fixed to the canonical repo and workbook.
- CommentPilot guard remains isolated to its own repo.
- Every run leaves a machine-readable next action in §0 and a human-readable
  latest handoff.
- No additional Claude Code 247 automation is created without an ADR/workbook
  change.

---

## §3 · Handoff Interface

`docs/handoff/production-handoff-latest.md` must contain:

- current branch and commit status;
- active workbook stage and exact next action;
- automations active/paused;
- files changed by the latest run;
- validation commands with pass/fail;
- evidence paths;
- holds/blockers and owner decisions needed;
- any running or intentionally skipped long command.

The handoff is mutable. Dated handoff/evidence files are append-only context,
but autonomous continuation should trust the latest handoff plus this workbook
first.
