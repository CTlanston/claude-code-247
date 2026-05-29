# ADR-0019 — Real E2E Loop (docker-claude · dual-family · model_usage · live draft PR)

# Status

Accepted — operator-directed (2026-05-29). Implementation + L2/L3 review tracked
under Stage E2E-1 in `EXECUTION_WORKBOOK.md`. The **live run** is explicitly
gated on an operator GO (operator chose "build, checkpoint before live run").

# Context

The core value loop (`real coder → evidence → dual-family validation → real
draft PR → token accounting`) has **never run on real LLM work, end to end, even
once**. Verified against the tree this session (not the handoff's stated line
numbers):

- **Coder defaults to mock.** `mission-runner.ts` routes `coder` via
  `routeRole('coder')` → `buildRunnerConfig()` → `providerToRunnerMode()`, which
  maps only `claude-cli | codex-cli | mock` and **falls through to `mock`**.
  There is no docker-claude mode. `RunnerManager.getRunner` supports
  `mock | docker | claude-cli | codex-cli | subscription-pool | claude247-bridge`,
  but `DockerRunner` is a generic "mount a workdir + run a command" primitive
  (default image `alpine:3.20`, default command a smoke `echo`) — it does **not**
  run `claude`.
- **Validators default to `[]`.** `mission-runner.ts:186`
  (`this.opts.validators ?? []`) is the real reason `validator_results = 0`.
  The real `OpenAIValidator` + `GeminiValidator` and the dual-family enforcement
  (`MergePolicy` + `family-enforce`, keyed off `coderFamily` +
  `requireIndependentValidatorFamilies`) already exist but are never injected at
  the 3 production construction sites (`daemon.ts:62`, `server.ts:40`,
  `routes/operator.ts:836`).
- **`model_usage` has a table but no writer.** `core/migrations.ts:106` already
  defines `model_usage(id, task_id, run_id, auth_mode, model, provider,
  input_tokens, output_tokens, cost_usd, notes, created_at)` and `core/schema.ts`
  has the `ModelUsage` type — so **no schema change is needed** (GR#4 already
  satisfied). But there is **no `db.insertModelUsage()`** and nothing writes rows.
  Meanwhile `LocalCliRunner` **already captures** the data: it writes
  `model-usage.json` (`{provider, inputTokens, outputTokens, costUsd, durationMs}`)
  into the evidence dir, sourced from `ClaudeCodeAdapter`'s parse of
  `claude --print --output-format json` (`usage.input_tokens` / `output_tokens` /
  `total_cost_usd`). The gap is purely: read it → price it → persist it.
- **Claude subscription auth is in the macOS keychain, not a mountable file.**
  `~/.claude/.credentials.json` does **not** exist; `security find-generic-password`
  shows a `genp` keychain entry. A macOS keychain **cannot** be bind-mounted into
  a Linux container. This is the central risk and the reason the live run is
  checkpointed.
- **`live draft PR` path is real and proven safe** (P3): `remote-write-gh.ts`
  (`GhGitRemoteWriter` + `GhDraftPrCreator`) behind `DraftPrGate`; this session's
  `p3-remote-smoke` PASS confirms gate-off blocks, gate-on opens a draft-only,
  never-merged, idempotent PR.

GR#8 requires the `claude` CLI subprocess to live in a **worker**, not the
daemon. A Docker container is the unambiguous worker boundary; that is why this
ADR keeps the dockerized path as the target rather than a host subprocess.

# Decision

## D1 — claude-in-docker coder (`ClaudeDockerRunner`)

Add a new `RunnerInterface` implementation `ClaudeDockerRunner` and a new
`RunnerMode` value `'claude-docker'`. Wire it via a new `RouteDecision.provider`
`'claude-docker'` mapped in `providerToRunnerMode()` / `resolveProviderFromMode()`
/ `providerToFamily()` (→ `anthropic`).

`ClaudeDockerRunner.run(task, config)`:
1. Prepare the per-task worktree (clone `config.sourceRepoPath`, mirroring
   `LocalCliRunner.prepareWorktree`).
2. **Materialize the subscription credential**: read the Claude Code OAuth
   credential from the macOS keychain into a private temp file
   (`<tmp>/.credentials.json`, mode 600), to be mounted **read-only** at the path
   the container's `claude` expects (`/root/.claude/.credentials.json`). The
   temp file is deleted in a `finally` (never persisted; never committed).
3. `docker run --rm` with: worktree (rw), evidence dir (rw), credential file
   (**ro**); **`ANTHROPIC_API_KEY` / `ANTHROPIC_BASE_URL` / `ANTHROPIC_AUTH_TOKEN`
   stripped** inside the container (no-silent-API-fallback, mirroring
   `ClaudeCodeAdapter`); image must already contain the `claude` CLI
   (`AEDEV_CLAUDE_DOCKER_IMAGE`, no default fallback — absence is a HOLD, never an
   alpine no-op).
4. Container command: `claude --print --output-format json` with the task prompt;
   parse `usage.{input_tokens,output_tokens}` + `total_cost_usd` exactly as
   `ClaudeCodeAdapter` does, and write the same evidence files
   (`plan.md`, `diff-summary.md`, `test-summary.md`, `done-report.md`,
   `transcript-summary.md`, `model-usage.json`).

**No silent API fallback.** If the credential cannot be materialized, the image
lacks `claude`, or the container cannot authenticate the subscription, the runner
**raises `HOLD-CLAUDE-AUTH-IN-DOCKER`** (or `HOLD-CLAUDE-DOCKER-IMAGE`) and the
mission holds. It must **never** switch to the paid API to "make it work"
(CLAUDE.md non-negotiable #6).

## D2 — default dual-family validators

A production factory `buildDefaultMissionValidators()` returns
`[GeminiValidator, OpenAIValidator]`. Keys are resolved **at run time via the
operator secrets path** (`SecretGrant` + `secrets-mcp` / `run_with_secrets`), not
hardcoded env and not committed. The factory is injected at the 3 production
`new MissionRunner` sites (`daemon.ts`, `server.ts`, `routes/operator.ts`); tests
keep injecting fakes.

With `coderFamily = anthropic` (claude-docker), the two validator families
`openai` + `google` are independent → `MergePolicy` with
`requireIndependentValidatorFamilies = true` is satisfied only when **both**
pass. Family conflict routes to the existing `HOLD-FAMILY-CONFLICT`.

## D3 — model_usage persistence (event → table)

Add `db.insertModelUsage(row)` (table already exists) and
`db.listModelUsage()` / a count helper for evidence. Extend the `EventType`
union with `'model.usage.recorded'` (documentation only; `insertEvent` already
takes `string`).

After the coder run, `mission-runner` reads `model-usage.json` from
`run.evidenceDir`, then:
1. prices it — prefer the CLI-reported `costUsd` (subscription estimate); fall
   back to `CostTagger.tag({model, inputTokens, outputTokens})` when `costUsd` is
   absent. (Note: `DEFAULT_PRICING` lacks `claude-opus-4-8`; unknown models tag
   to `0`, which is why the CLI `costUsd` is preferred and the model name is
   always preserved for later reconciliation.)
2. `db.insertModelUsage({taskId, runId, authMode, model, provider, inputTokens,
   outputTokens, costUsd, notes})` (the table write / "view"),
3. `db.insertEvent('model.usage.recorded', 'mission', missionId, {...})` (audit
   event), and `CostRoller.record({ts, costUsd, bucket: missionId})`.

This mirrors the established `insertRun + insertEvent` pattern (table write
alongside an audit event). Subscription usage is reported as real token counts +
a CLI cost **estimate**; per CLAUDE.md it is never reported as "$0".

## D4 — live draft PR (reuse, do not rebuild)

Reuse `remote-write-gh.ts` (`GhGitRemoteWriter` + `GhDraftPrCreator` behind
`DraftPrGate`) exactly as `p3-remote-smoke` does: draft-only, title-hash
idempotent, never merged. For the live run, `allow_remote_writes` is opened for
**one run against `multi-agent-brainstorm` only**, then reset to `false`
(`auto_merge.enabled=false` in `repos.yaml` guarantees no merge). `forbidden_paths`
(`.env*`, `secrets/**`, `.github/**`, `CLAUDE.md`, `AGENTS.md`) are enforced.

# Consequences

**Positive.** First real tokens + first dual-family verdicts + first live draft PR
produced by the loop; `model_usage` finally has rows; the mock-only seam is gone.

**Risks / honest caveats.**
- **Keychain-auth-in-docker may not be feasible on this Mac** (no mountable
  credential file; token may be host-bound / short-lived). This is a likely HOLD
  at the live run — and is precisely why the operator gated the live run. No
  silent API fallback under any failure.
- **A `claude`-capable Linux image is a prerequisite** (alpine has no `claude`).
  Absence → HOLD, not a silent mock.
- **Cost.** The live run spends real subscription-Claude + OpenAI + Gemini
  tokens. Unit tests in this stage spend nothing (all adapters mocked).
- **Pricing gap** for `claude-opus-4-8` in `DEFAULT_PRICING` — mitigated by
  preferring the CLI `costUsd` and preserving the model name.

**Testing strategy (this stage, pre-checkpoint).** TDD with mocks/fakes only:
`ClaudeDockerRunner` with an injected docker-exec fn (asserts argv: ro
credential mount, stripped API env, `--output-format json`, image-absent → HOLD);
`db.insertModelUsage` round-trip + `model.usage.recorded` event; mission-runner
reads `model-usage.json` → persists model_usage with injected fakes;
validator-factory shape with a fake secret resolver. **No live API, no Docker
pull, no remote write** until the operator GO.

# Alternatives considered

- **Host `claude` subprocess (LocalCliRunner) instead of docker** — already
  exists and would avoid the keychain-mount problem, but blurs GR#8's
  worker/daemon boundary; kept only as an explicitly operator-approved fallback,
  never a silent one.
- **`model_usage` as an event-sourced view via a reducer** — rejected for now;
  the codebase writes domain tables directly alongside audit events
  (`insertRun`+`insertEvent`), so a direct `insertModelUsage`+event matches the
  existing pattern and avoids a new projector.
- **Hardcode validator keys from env** — rejected; violates the secrets policy.
  Keys resolve via `SecretGrant`/`secrets-mcp` at run time.

# Date

2026-05-29
