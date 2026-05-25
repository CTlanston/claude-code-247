# ADR-0008: Product Spine — Python `claude247` is Production, TypeScript `aedev` is Experimental

**Status:** Accepted  
**Date:** 2026-05-25  
**Supersedes:** (none — first explicit product-spine record)

---

## Context

The `claude-code-247` repository contains two overlapping product implementations:

1. **Python `claude247`** — a mature, GA-released (v1.0.0) local-first 24/7
   autonomous engineering system.  It has a working orchestrator, task runner,
   validator bridge, risk policy, GitHub integration, memory compiler, launchd
   integration, and a live watchdog dashboard.  It has 19 passing GA gates and
   has been in production soak since 2026-05-25.

2. **TypeScript `aedev`** — a ground-up rewrite targeting a cleaner
   architecture (pnpm monorepo, Fastify v5, better-sqlite3, Vite+React
   dashboard, typed state machine).  The package skeleton, database schema,
   state machine, CLI scaffold, Fastify daemon routes, and React dashboard UI
   are written and have passing unit tests.  **However**, key runtime paths
   are not yet implemented:
   - `DockerRunner.run()` — throws `ExperimentalFeatureError`
   - `ClaudeCodeAdapter.run()` — throws `ExperimentalFeatureError`
   - `GeminiValidator` / `OpenAIValidator` — return `inconclusive`; real API
     calls not implemented
   - `WorktreeManager` is not yet wired into `RunnerManager`
   - GitHub sync routes exist but are stubs backed by Octokit scaffolding
   - The dashboard shows live SSE state but cannot trigger real work

Because the repository's README and documentation did not clearly distinguish
production from prototype, there was a risk of someone running `aedev` commands
expecting production behaviour, or of the auto-merge policy allowing merges
without validators.

---

## Decision

**Python `claude247` is the production product for the v1.x line.**

**TypeScript `aedev` is an explicitly experimental next-generation prototype.**

Concretely:

1. The README quick start uses `claude247` (Python).  `aedev` instructions
   appear under a clearly labeled "Experimental aedev prototype" section.

2. The `v1.0.0` GA status and all associated release documentation apply
   exclusively to Python `claude247`.

3. The TypeScript `MergePolicy` must never return `AUTO_MERGE` unless at
   least two independent validators both return `pass` and risk score is low
   (< 30).  Empty validators, single validator, inconclusive, or any failure
   always prevents auto-merge.  This is enforced by unit tests.

4. The TypeScript `IntakeService` requires a two-step approval flow:
   `requestApproval()` followed by a distinct `approveMission()` call.
   No component may self-approve.  This is enforced by unit tests.

5. `DockerRunner` and `ClaudeCodeAdapter` throw a typed
   `ExperimentalFeatureError` — not a generic `Error` — so callers can
   distinguish "prototype placeholder" from real runtime failures.  Tests
   assert on the class.

6. Migration from Python to TypeScript requires a separate migration plan and
   explicit green end-to-end acceptance on all nine verification gates (see
   `docs/aedev-prototype-status.md`).

---

## Alternatives Considered

**Promote TypeScript `aedev` to production immediately.**  Rejected.  The
Docker worker, Claude Code adapter, and dual-validator paths are not
implemented.  Auto-promoting would misrepresent the system's capabilities and
violate the merge policy invariant.

**Delete TypeScript `aedev` and commit to Python only.**  Rejected.  The
TypeScript prototype has a cleaner architecture, working tests, and is the
intended migration target.  Discarding it would lose the design investment.

**Keep both systems in parallel with no explicit policy.**  Rejected.  This
is the ambiguous state that prompted this ADR.  Ambiguity is the risk.

---

## Consequences

**Positive:**
- Operators know which CLI to use in production.
- The merge policy is safe by default even in the TypeScript prototype.
- No future commit can accidentally auto-merge without two validators passing.
- `ExperimentalFeatureError` makes test assertions precise and failure messages
  actionable.

**Negative / trade-offs:**
- TypeScript `aedev` cannot be used for real autonomous work until the Docker
  runner and Claude adapter are implemented.
- Two codebases must be kept buildable (Python: `make install + pytest`;
  TypeScript: `pnpm install + pnpm test + pnpm typecheck`).

**Migration trigger:**
When all nine gates in `docs/aedev-prototype-status.md` turn green, open a
dedicated migration PR that retires the Python system and promotes TypeScript
`aedev` to the production quick start.  That PR must be reviewed under this
repository's medium-risk merge policy (human approval required).
