# Decisions log

Important assumptions, cost decisions, and architecture decisions taken by
the supervisor or by Claude during AutoDev v3 implementation. Latest at
bottom.

---

## 2026-05-11

### DEC-001 — Module location

Spec §4 calls for `autoevo/autodev/`. This repo's existing package is
`orchestrator/`, not `autoevo/`. Per spec §4 ("If the repository uses a
different package/module naming convention, adapt paths while preserving
these responsibilities") the AutoDev v3 modules are placed at top-level
`autodev/` to avoid pretending a non-existent `autoevo/` package exists.

### DEC-002 — Default cost mode is `cheap`

`HUMAN_CONFIG.md` is not present (HOLD-1). Defaulting to the safest mode:
`cost.mode=cheap`, `api_spend_allowed=false`. The cost controller enforces
that no Anthropic SDK call can happen even if existing inner-engine code
attempts one — see `autodev/cost_policy.py`.

### DEC-003 — Live mode disabled by default

`live_allowed=false` and `autostart_allowed=false` until the human edits
`HUMAN_CONFIG.md`. The dry-run path is fully functional; the live single
cycle and long-running supervisor (spec §17/§18) are gated.

### DEC-004 — Inner engine NOT rewritten

Per spec §2.1: existing `orchestrator/main.py` state machine, `runner.py`,
`git_proxy.py`, `github_client.py`, `circuit_breaker.py`, `db.py`, and
`local_runner.py` are preserved unchanged. `autodev/inner_engine.py`
calls them via subprocess (`python3 -m orchestrator.main --one-shot`) so
the outer loop can survive death of the inner-engine process.

### DEC-005 — No git push during implementation

`AUTODEV_CLEANUP_TASK.md` from the previous session said "Do not git push
to any remote". That constraint persists in this implementation session.
The supervisor's `live` mode can push to **shadow branches** of test repos
only after `HUMAN_CONFIG.md` sets `runtime.live_allowed=true`. Never
pushing to `main`.
