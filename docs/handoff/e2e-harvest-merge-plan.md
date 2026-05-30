# E2E-Harvest — Merge Resolution Plan & Handoff

> Written mid-harvest (token budget hit) so STEP 2–4 resume cleanly. STEP 1 is
> DONE + committed. The squash-merge was attempted, conflicts inventoried, then
> **aborted** to leave both worktrees clean. Nothing is lost.

## State at handoff

- **Main checkout** `/Users/lanston/projects/claude-code-247` on `codex/v24-vertical-slice`,
  HEAD `6c8985f` `[carryover] codex builder WIP: s_0034/s_0035 ...`, **tree clean**
  (Codex's uncommitted hold-recheck WIP was committed here first, per operator).
- **My branch** `claude/e2e-1` in worktree `/Users/lanston/projects/cc247-e2e1`,
  HEAD `a4239e4`, tree clean. Carries E2E-0/1/1-hardened/2 + the L3 shadow-walk fix.
- **Gate**: `~/.claude-code-247/config.yaml` `allow_remote_writes: false` (verified).
- **gh auth**: WORKS now (`CTlanston`, repo+workflow scopes) — Codex's s_0035 "gh auth failed" was transient/stale. PR #12/#13 readable, still `isDraft:true`.
- **Codex builder**: last wrote 18:08 (s_0035), idle since; independently hit the
  same `HOLD-CLAUDE-AUTH-IN-DOCKER` that `claude/e2e-1` already RESOLVES.
- Codex WIP backup (insurance): `/tmp/codex-wip-backup/`.

## STEP 1 — DONE (committed on claude/e2e-1)

- `a4239e4` [E2E-2] L3 shadow walk + fix question-id ULID-slice collision; accept 14/14
- Shadow walk 12/12 PASS (evidence/e2e/s2/shadow-walk.log): gate intercepts ambiguous
  mission, NO LLM token spend, ≤4 questions, clarified-spec.md + resolved event,
  clear mission not over-gated. Fixed a real ULID-slice id-collision bug found via
  the spec render.

## STEP 2 — squash-merge (NEXT). `git merge --squash claude/e2e-1` gives 5 conflicts:

Resolution plan per file (verified intent, not blind ours/theirs):

1. **packages/runner/src/claude-docker-runner.ts** (UU) — the crux.
   - Codex `300eeb5` added: `statSync` import; `ClaudeDockerHoldCode`/`...PreflightIssue`/
     `...PreflightResult`/`...RuntimePreflightResult`/`...PreflightOptions` types;
     `preflightClaudeDockerEnvironment()`; `ClaudeDockerRunner.preflightRuntime()`;
     `buildDockerPreflightArgs()`, `defaultCredentialFileProbe()`, `shellQuote()`,
     `holdReason()`; a `defaultCredentialFileProbe` check in `materializeCredentialFromEnv`.
   - My `claude/e2e-1` rewrote the SAME file for hardening: cli-envelope.json token
     read, `renderRealDiffSummary()`, entrypoint-contract (prompt.txt + CLAUDE_ROLE,
     no CMD), `ClaudeDockerAuth` token|file modes, env-stripping in buildDockerArgs.
   - **RESOLUTION: keep BOTH.** Take my hardened file as the base, then GRAFT Codex's
     preflight additions (the new types + `preflightClaudeDockerEnvironment` +
     `preflightRuntime` + helpers + statSync import). They're additive (separate
     functions); the only overlap is `materializeCredentialFromEnv` (my version is
     authoritative; add Codex's `defaultCredentialFileProbe` readable-check into it)
     and `buildDockerArgs` (mine — entrypoint-contract — wins; Codex's preflight uses
     its own `buildDockerPreflightArgs`). Reconcile `redactCredentialHostPath` vs my
     `redactAuthSecrets` (keep both; preflight uses the former).
   - After graft: `pnpm --filter @aedev/runner typecheck` + run BOTH
     claude-docker-runner.test.ts suites (mine + any Codex preflight tests).

2. **packages/runner/src/index.ts** (UU) — union of exports. Keep my exports
   (ClaudeDockerAuth etc.) + Codex's preflight exports (preflightClaudeDockerEnvironment,
   the preflight types). Mechanical.

3. **packages/daemon/src/index.ts** (UU) — union: my ClarificationGate exports +
   whatever Codex added. Mechanical.

4. **EXECUTION_WORKBOOK.md** (UU) — both rewrote §0/§9 heavily. Prefer claude/e2e-1's
   §0 (E2E-2 state) but FOLD IN Codex's §9 entries (s_0030–s_0035) so no session log
   is lost. This is the "reconcile vs codex churn" the workbook keeps referencing.

5. **docs/handoff/e2e-real-loop-plan-and-prompt.md** (DU: deleted in codex HEAD,
   modified in claude/e2e-1) — Codex deleted it; my branch only carried it from base.
   It's the original planning doc, now superseded. **RESOLUTION: accept the deletion**
   (`git rm`) — it's the kickoff plan, fully realized; this very handoff replaces it.

After resolving: `git add -A`, then full suite (`pnpm typecheck && pnpm lint && pnpm test`)
GREEN before committing the squash. Commit:
`[E2E-Harvest] squash-merge claude/e2e-1: E2E-0 unblock + E2E-1 real loop & model_usage + hardening (runner:e2e1) + E2E-2 clarification gate (ADR-0019/0020)`.

## STEP 2e — PR ready (gh auth works):
- Backup config, set `allow_remote_writes: true`, `gh pr ready 12` + `gh pr ready 13`
  on `CTlanston/multi-agent-brainstorm`, verify `isDraft:false`, **immediately** set
  `allow_remote_writes: false` again and verify. (These PRs are independent of the
  code merge — readying them doesn't merge them.)

## STEP 3 — tech debt (small batches, on codex/v24 after merge):
- Version → `v2.4.0-patch1`: `package.json` (0.0.1), status route (hardcoded v2.4),
  `RELEASE_NOTES_GA` (v1.0.0), `lead-agent.ts` (v2.3). grep exact strings first.
- ADR-0013 dup: two `docs/adr/0013-*.md` — renumber the later one to next free (0021;
  0019/0020 now exist). Update references; don't renumber existing referenced ADRs.
- Archive stale root *.md → `docs/archive/` in batches of ~6. **KEEP IN ROOT:
  README.md, EXECUTION_WORKBOOK.md, CLAUDE.md (FORBIDDEN PATH — never move, CLAUDE.md
  non-negotiable #3), AGENTS.md (forbidden, if present), PRODUCTION_WORKBOOK.md.**
  List all 32 + show keep/move split BEFORE moving.

## STEP 4 — workbook + changelog:
- §0 stage → `ProductionHardened_v2.4_Ready`; new §9 + §10 changelog row w/ merge SHA.
- Full suite green (≥586 tests; confirm exact). Validate YAML; don't break §3.99.

## Guardrails reaffirmed
- Re-verify Codex idle (`git log -1 --format=%ci codex/v24-vertical-slice`) right
  before merging. CLAUDE.md/AGENTS.md never moved. No silent empty catch. Small
  tool batches. Verify-before-claim; real numbers only.
