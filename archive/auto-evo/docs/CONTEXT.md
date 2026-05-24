# CONTEXT.md — System Invariants

> This file is the L7 memory of "how this system is supposed to work."
> It is updated ONLY via an ADR. See `docs/adr/` and §5 of
> `AUTODEV_L7_MASTER_PROMPT.md`.

## 1. System purpose

`claude-code-247` is a local, subscription-only, 24/7 autonomous engineering
runtime that takes well-spec'd GitHub issues from a test repo
(`CTlanston/auto-evo-playground`) and produces draft PRs with TDD discipline,
zero paid-API spend, and no human babysitting per task.

Two stacked layers on the same codebase:

| Layer | Purpose | Lives in |
|---|---|---|
| **Auto-Evo inner engine** | 4-role state machine (Planner → Coder → Reviewer → Guardian) driving one GitHub Issue → Draft PR through shadow-branch CI | `orchestrator/`, `runner/` |
| **AutoDev v3 outer loop** | Supervisor + state machine + cost policy + recovery + hold-on protocol wrapping the inner engine | `autodev/`, `scripts/autodev_*.sh`, `reports/`, `tasks/` |

On top of both, the L7 protocol (this directive) adds a self-evaluation
rubric (§3) measured by artifacts on disk, with per-cycle memory updates.

## 2. Architecture overview

Inner engine state machine (per issue):
```
new → planning → coding → reviewing → ci_running → human_review
                  ↓ retry      ↓ reject
                  diagnosing (V4+) ──→ blocked
```

Outer loop state machine (cross-cycle):
```
idle → selected → in_progress → completed
                       ↓ blocker
                       blocked → human_clear → in_progress
```

L7 wake-cycle (per invocation):
```
ORIENT → PLAN → ACT → VERIFY → RECORD → EXIT
```

## 3. Guardian contract (the cost / safety pause)

Guardian pauses dispatch when ANY of:
- Daily billable cost spike > 2× the 7-day moving average.
  **Subscription-aware**: under `sk-ant-oat01-` or `CLAUDE_CODE_OAUTH_TOKEN`,
  every `runs.cost_usd` is zeroed at INSERT time via
  `orchestrator.billable.to_billable_cost()`. The DB itself shows $0. Guardian
  cannot see phantom subscription cost. See ADR-0001.
- CI failure rate > 50% in the last hour
- Reviewer rejection rate > 50% in 24h
- Same file modified > 5 times in 24h (loop indicator)
- > 30% of today's issues hit a hard error
- Audit table shows an unauthorized actor or credit deduction > 50 at once

**Pauses are recommendations, not crashes.** The supervisor logs the pause,
writes `ALERT.md`, stops dispatching, and does NOT crash. The pause clears
when a human inspects and clears `state/PAUSED`, OR when a health-recovery
signal proves the trigger condition has gone away.

NEVER clear `state/PAUSED` as a "fix" for an active Guardian trigger. Fix the
root cause first; document via ADR.

## 4. Reviewer contract (Staff Engineer mode, V4 softened)

The Reviewer rejects when ANY:
- A whitelist-violating file is touched (`.github/`, `Dockerfile`, `*.lock`,
  `.env*`, `pyproject.toml` dependency block, `secrets/**`)
- An existing test is deleted or its assertion weakened
- A new unfamiliar dependency is introduced
- The diff has NO test changes at all
- ALL test commits land AFTER ALL impl commits (TDD-intent failure)
- ≥ 3 soft issues accumulate (boundary, drift, scope creep, complexity)

The Reviewer does NOT reject for:
- Edge-case test commits added AFTER the impl commit on the same branch
  (V4 softened — see ADR-0003)
- Cosmetic / taste-level complaints
- "I would have done it differently" without a concrete defect

TDD intent (V4): at least one `test:` / `tests:` / `spec:` / `specs:` /
`coverage:` commit precedes at least one `feat:` / `fix:` / `impl:` /
`implement:` / `refactor:` commit on the branch. Strict per-step ordering
is NOT required.

## 5. Cost model

Two modes, detected at runtime by token prefix:

| Auth | Prefix | Billable cost | Use |
|---|---|---|---|
| Subscription / OAuth | `sk-ant-oat01-` OR `CLAUDE_CODE_OAUTH_TOKEN` env set | Always $0 (user pre-paid) | Default; covers all 24/7 operation |
| API | `sk-ant-api03-` | Pass-through real $$$ | Only with explicit human override + `cost.daily_usd_cap > 0` + `cost.premium_guardian_allowed: true` |

Helper: `orchestrator.billable.to_billable_cost(raw, in_tokens, out_tokens)`.
Used at `orchestrator.db.record_run` INSERT time, so the DB is the single
source of truth. See ADR-0001.

Zero-token-zero-cost guard: if both token counts are 0 regardless of mode,
billable is forced to $0 (CLI ghost-cost on early-exit must not poison
metrics).

## 6. Live mode

"Live mode" = the supervisor is allowed to:
- Push shadow branches to GitHub (NEVER `main`)
- Open draft PRs (NEVER auto-merge)
- Comment on issues / PRs
- Spend on the subscription session

Live mode is gated by ALL of:
1. `HUMAN_CONFIG.md:live_allowed: true`
2. `HUMAN_CONFIG.md:autostart_allowed: true` (for 24/7 launchd install)
3. `AUTODEV_LIVE=1` env var at invocation time
4. No active Guardian pause
5. Health score >= 70 (per §10)

Dry-run is the default. Live mode is opt-in per invocation.

## 7. Module index

| Path | Role |
|---|---|
| `orchestrator/main.py` | Inner-engine state machine + `_do_planning`, `_check_tdd_invariant` |
| `orchestrator/billable.py` | V4 cost helper — `to_billable_cost`, `is_subscription_mode`, `load_budget_metrics` |
| `orchestrator/preflight.py` | V4 impossible-spec detection (symbol absent + file forbidden) |
| `orchestrator/db.py` | SQLite state store; `record_run` is the cost-write chokepoint |
| `orchestrator/circuit_breaker.py` | Per-role rate / cost limits |
| `orchestrator/git_proxy.py` | Git operations + shadow-branch mirror (V4-era fallback path) |
| `orchestrator/github_client.py` | PyGithub wrapper (V4-era defensive exception handling) |
| `orchestrator/roles/*.md` | Role prompts (planner, coder, reviewer, guardian) |
| `orchestrator/runner.py` | Subprocess invocation of role containers |
| `runner/` | Docker image baseline for role containers |
| `runner/roles/*.md` | Image-baked copies of role prompts |
| `autodev/supervisor.py` | Outer-loop driver with V4 `_resolve_state_db_path` |
| `autodev/inner_engine.py` | Adapter calling `orchestrator/main.py` |
| `autodev/cost_policy.py` | Outer-loop budget gating |
| `autodev/recovery_manager.py` | Hold + retry protocol |
| `tests/test_v4_*.py` | V4 regression suite (30 tests) |
| `scripts/autodev_*.sh` | CLI entry points |
| `scripts/compute_level.py` | L7 rubric scorer — sole authority on `LEVEL.md` |
| `cycles/<ID>/` | Per-cycle PLAN/RESULT/REPORT artifacts |
| `docs/adr/NNNN-*.md` | Architectural decision records (append-only) |
| `CHANGELOG.md` | One-line-per-cycle audit trail (append-only) |
| `FAILURES.md` | Indexed failure ledger (append-only; injected into every PLAN) |
| `BACKLOG.md` | Ordered track queue |
| `STATE.md` | Rewritten each cycle; previous snapshot in `cycles/<id>/STATE.before.md` |
| `LEVEL.md` | Read-only output of `compute_level.py` |

## 8. Forbidden patterns

The hard constraints from §0 of `AUTODEV_L7_MASTER_PROMPT.md` are
non-negotiable. Highest-leverage forbidden patterns:

- Calling `api.anthropic.com/v1/messages` from generated code (paid API)
- Any `git push` (locally we live on feature branches; the human pushes)
- Auto-merging PRs
- Reading or echoing `.env*`, `secrets/**`, `*.key`, `*.pem`
- Hand-editing `LEVEL.md` (it is generated)
- Deleting entries from `FAILURES.md` / `CHANGELOG.md` / `docs/adr/`
- Clearing `state/PAUSED` while the Guardian trigger is still active
- `git reset --hard` to anything other than `autoevo/pre-<CYCLE_ID>`
- Force-push (banned by the no-push rule anyway)
- Softening a safety gate (Guardian / preflight / TDD invariant / sanitizer /
  action-layer evaluator) to make a test pass

## 9. Subscription-only safety net

Every cycle's first sanity check before any role invocation:
```python
from orchestrator.billable import is_subscription_mode
assert is_subscription_mode(), "Refusing to run: paid-API mode detected"
```

If the active token is `sk-ant-api03-` and there is no explicit human override
in `HUMAN_CONFIG.md`, the cycle MUST write `BLOCKED.md` and exit.

---

This file is alive only via ADRs. To change an invariant: write
`docs/adr/NNNN-<slug>.md`, link the regression test, then update this file
in the same commit.
