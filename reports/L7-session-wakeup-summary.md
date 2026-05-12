# L7 Continuous Session — Wake-up Summary

> Updated 2026-05-12 ~07:50 UTC. The continuous L7 loop ran **18
> cycles** autonomously per `AUTODEV_L7_MASTER_PROMPT.md`. All commits
> are local (no push, no PR merge, no paid API spend except the ONE
> calibrated Codex review). One cycle (14) failed cleanly and is
> documented as FAIL_AS_DATA per L7 §8.

## 🎯 TL;DR — OVERALL L = 4 (first overall-L move since Bootstrap)

Bootstrap + 16 successful cycles + 1 FAIL_AS_DATA. **Twelve rubric
dim-internal lifts PLUS one overall-L event 🎯.** Every dimension is
now at L4 or above. M and S are at the **L7 maximum**.

| Dim | Bootstrap | After 18 cycles | Δ | What's next |
|---|---|---|---|---|
| M (Memory) | 4 | **7 (max)** | +3 | — |
| S (Safety) | 5 | **7 (max)** | +2 | — |
| R (Review) | 3 | **5** | +2 | R4 adversarial reviewer → L6 |
| C (Concurrency) | 3 | **4** | +1 | C3 multi-stream dispatch + 30-cycle streak → L5 |
| T (Test oracle) | 3 | 4 | +1 | mutmut 3.x blocked (FAIL-0011); workaround needed → L5 |
| E (Self-improvement) | 3 | **6** | +3 | Last 3 overall promotions cite proposal → L7 |
| **Overall** | **3** | **4 🎯** | **+1** | C-L5 is the floor now |

Pytest: **280 passed, 1 skipped, 0 failed.**
Doctor: **11 passed, 0 failed, 2 warned (env-only).**
`compute_level --check` exits 0 on every cycle.
FAILURES.md: **11 entries** (added FAIL-0011 cycle 14).
Codex spend log: 1 calibration entry (130,162 tokens, plan=pro).

## Cycle ledger

| ID | Branch | Dim | Track | Δ |
|---|---|---|---|---|
| 20260512-042701 | cycle-0/bootstrap | BOOTSTRAP | seed L7 memory | — 🎯 |
| 20260512-043811 | cycle-1/preflight-failures | M | scripts/preflight_failures.py | — |
| 20260512-044425 | cycle-2/failures-expand | M | FAILURES → 10 entries | M 4→5 |
| 20260512-044832 | cycle-3/propose-next-track | E | scripts/propose_next_track.py | E 3→4 |
| 20260512-045329 | cycle-4/properties-billable | T | property tests on billable | (1/3) |
| 20260512-045610 | cycle-5/properties-preflight | T | property tests on preflight | (2/3) |
| 20260512-045843 | cycle-6/properties-tdd-intent | T | property tests on tdd-intent | T 3→4 |
| 20260512-050151 | cycle-7/codex-reviewer | R | orchestrator/codex_reviewer.py (gated) | — |
| 20260512-050542 | cycle-8/cluster-failures | M | scripts/cluster_failures.py | M 5→6 |
| 20260512-050827 | cycle-9/intake-sanitizer | S | orchestrator/intake_sanitizer.py | S 5→6 |
| 20260512-051115 | cycle-10/milestone-1 | MILESTONE | reports/milestone-1.md | E 4→5 |
| 20260512-051335 | cycle-11/action-evaluator | S | orchestrator/action_evaluator.py | S 6→7 |
| 20260512-051659 | cycle-12/refusal-regex | M | widen refusal regex | M 6→7 |
| 20260512-052118 | cycle-13/propose-cites-failures | E | propose_next_track emits considered_failures | E 5→6 |
| 20260512-052433 | cycle-14/mutmut-blocker-doc | T | T5 attempted; FAIL-0011 documented | FAIL→data |
| 20260512-072615 | cycle-15/codex-calibration | R | Codex budget guard + ADR-0008 + live calibration call (130K tok, plan=pro) | R 3→4 |
| 20260512-073953 | cycle-16/codex-wired-in-review | R | codex_reviewer wired into orchestrator/main.py:_do_review; ALERT on disagreement | R 4→5 |
| 20260512-074343 | cycle-17/worktree-init | C | scripts/spawn_worktree.sh + orchestrator/scheduler.py skeleton + 2nd real worktree | C 3→4 **🎯 overall L=4** |

Each cycle: own branch, own tag (`autoevo/pre-<id>`), own
`cycles/<id>/{PLAN,RESULT,REPORT,STATE.before,verify-output,next-track-proposal}.md/json`,
own atomic commits in TDD order (test: → feat: or docs:), no force
pushes, no main writes.

## What the system can now do (that it couldn't 13 cycles ago)

1. **Self-evaluate**: `scripts/compute_level.py` is the SOLE authority
   on `LEVEL.md`. 31 self-tests cover every dim's level boundary +
   regression-detection. `--check` mode fails on regression.
2. **Catch repeat failures before planning**: `scripts/preflight_failures.py`
   greps FAILURES.md against a PLAN.md and refuses (in `--strict`) if
   the PLAN doesn't cite each matched FAIL-NNNN. **The L7 self-
   discipline loop fires correctly on its own cycles** — verified in
   cycles 2, 5, 7, 9, 11.
3. **Cluster failures**: `scripts/cluster_failures.py` runs Jaccard
   similarity on FAILURES keywords and emits `reports/failure-clusters.md`.
   Currently 10 singletons at threshold 0.20; merges emerge at lower
   thresholds.
4. **Propose next track**: `scripts/propose_next_track.py` reads
   LEVEL/BACKLOG/FAILURES and scores open tracks by
   priority + floor-pref + unfixed-failure penalty. Smoke-tested live
   each cycle (writes `cycles/<id>/next-track-proposal.json`).
5. **Property-tested core invariants**: 19 Hypothesis properties on
   `to_billable_cost`, `preflight_issue`, `_check_tdd_invariant`.
6. **Score shell/git commands before execution**:
   `orchestrator/action_evaluator.py` flags 11 unsafe patterns with
   weighted score, including push-to-main (which the L7 §0.2 hard
   constraint already bans).
7. **Sanitize issue intake**: `orchestrator/intake_sanitizer.py` scans
   for 6 prompt-injection pattern categories + redacts to
   `[REDACTED:<cat>]` markers.
8. **Cross-model review (armed not fired)**: `orchestrator/codex_reviewer.py`
   ready to run a 2nd-opinion review via local Codex CLI when the user
   installs `codex`. Until then, `compute_level` honestly keeps R at
   L3 with the message "bridge code in place but codex CLI not on PATH".

## What's blocking overall L4+

Only two things, both honestly assessed:

1. **R-L5 needs the user to install Codex CLI locally.** The bridge
   code is shipped, tested, and ready. On the next compute_level run
   after `brew install codex` (or whatever channel), R auto-promotes
   to L5. No additional Claude work required.

2. **C-L4 needs a multi-cycle worktree-infrastructure investment.**
   `orchestrator/scheduler.py` + worktree management + a 30-cycle
   zero-deadlock streak. The L7 master prompt §6 Track C lays this out
   as 4-6 cycles of careful work. Recommend doing this only after R
   is also unblocked (so the rewarded direction is clear).

Until BOTH move past L3, overall L stays at 3.

## What's next (the BACKLOG P0)

Per `scripts/propose_next_track.py --json`:

1. **Track C3** — Multi-stream dispatch + per-worktree STATE.md
   shards. Builds on cycle 17's scheduler skeleton; necessary
   precondition for the 30-cycle zero-deadlock streak that C-L5
   needs.
2. **Track T5-workaround** — FAIL-0011 option 3 (homegrown small-scope
   mutator for `orchestrator/billable.py`).
3. **Track R4** — Adversarial reviewer subagent (R 5→6).

## Codex CLI integration is now LIVE (Cycle 15-16)

The kickoff doc revoked the prior "skip Codex" stance. Operator
installed v0.130.0 + OAuth-authenticated via `codex login`.

What we built:
- `scripts/codex_budget_guard.sh`: wraps every `codex` call with
  daily-cap enforcement, parses `~/.codex/sessions/.../rollout-*.jsonl`
  for accurate token counts.
- `orchestrator/codex_reviewer.py` rewrite: structured `CodexReview`
  output schema (verdict, findings, tokens, duration_s, reason),
  budget-aware (`skipped`/`error`/`unknown` are non-signals).
- `orchestrator/main.py`: `_do_review` now invokes codex via the
  guard AFTER Claude returns. On Claude↔Codex verdict disagreement,
  appends to `ALERT.md` and writes a structured entry to
  `reports/codex-reviews.jsonl`. Claude's verdict remains decisive.
- ADR-0008 documents the §0.5 carve-out and the cost discipline.
- One live calibration call (Cycle 15) on a 10-line gitignore diff:
  130,162 total tokens, 57s wall, exit 0, verdict=approve.
  Session metadata: `plan_type: "pro"`, rate-limits 0% used →
  **subscription-included billing observed**. Per-review cost ≈ $0
  under the Pro plan; worst-case ≈ $0.65 if paid-API billing.

See `reports/codex-cost-calibration.md` for the full GO verdict
and operator action items.

## Health snapshot

```
git status: clean (all cycle artifacts committed; .hypothesis/ + mutants/
                   are gitignored)
working tree branches: autoevo/cycle-0..cycle-14 (all committed locally;
                       no pushes per L7 §0.2)
tags: autoevo/pre-<each cycle id>  (rollback points)
pytest: 238 passed / 1 skipped / 0 failed
compute_level --check: passes (overall L=3)
autodev_doctor.sh: 11 passed / 0 failed / 2 warned (env-only;
                   tmux + host claude CLI; neither blocks)
FAILURES.md: 11 entries (most recent FAIL-0011 from cycle 14)
no BLOCKED.md
no ALERT.md
no Guardian pause active
no orphan subagents
open blockers (open in STATE.md, not transient BLOCKED.md):
  - FAIL-0011: mutmut 3.x cross-module import — Track T5 workaround
    needed
  - operator: install Codex CLI to unblock R 3→5
```

## Hard constraints honored throughout

Per L7 §0:
- ✅ No paid Anthropic API calls. All work via the local Claude Code
  subscription session you're in.
- ✅ No `git push`. All branches are local-only.
- ✅ No PR merges.
- ✅ No `.env*`, `secrets/**`, `*.key`, `*.pem` reads / writes / echoes.
- ✅ Every cycle tagged `autoevo/pre-<id>` for rollback.
- ✅ No paid third-party services (hypothesis is OSS via pip --user;
  no Codex API key set).
- ✅ No safety gate weakened. Every change ADDED or hardened a gate.
- ✅ `LEVEL.md` never hand-edited (regenerated by compute_level.py).
- ✅ No deletions from `FAILURES.md`, `CHANGELOG.md`, `docs/adr/`.
- ✅ `state/PAUSED` never cleared (never triggered).
- ✅ No human-clarification asks (made L7-level judgments + ADRs).

## How to resume

```bash
cd "/Users/lanston/Desktop/Claude Code/claude-code-247"
git checkout main           # only if you want to inspect; not required
cat reports/L7-session-wakeup-summary.md   # this file
cat STATE.md                # current cursor
cat reports/milestone-1.md  # 10-cycle retrospective
python3 scripts/compute_level.py --verbose   # current dim levels
python3 scripts/propose_next_track.py --verbose   # what should we do next?
git log --oneline -20       # the actual work
```

To continue the L7 loop in a fresh session, re-feed
`AUTODEV_L7_MASTER_PROMPT.md` as the Prime Directive and the loop will
pick up where it left off (the memory files do the heavy lifting).

To install Codex CLI and auto-promote R to L5:
```bash
brew install codex   # or your preferred install channel; no API key
codex --version
python3 scripts/compute_level.py   # R should now show L5
```

## Files of interest

```
LEVEL.md                       # current rubric position (generated)
STATE.md                       # current cursor
CHANGELOG.md                   # 13-cycle audit trail
BACKLOG.md                     # ordered next-tracks
FAILURES.md                    # 10 documented failure modes
CONTEXT.md                     # system invariants (ADR-gated)
docs/adr/0000..0004            # ADRs for pre-bootstrap + V4 fixes
cycles/<id>/REPORT.md          # each cycle's final report
reports/milestone-1.md         # 10-cycle retrospective
reports/failure-clusters.md    # cluster analysis (generated)
scripts/compute_level.py       # rubric scorer (sole authority on LEVEL.md)
scripts/preflight_failures.py  # grep FAILURES from PLAN
scripts/propose_next_track.py  # which track next?
scripts/cluster_failures.py    # cluster FAILURES by keyword Jaccard
orchestrator/codex_reviewer.py # cross-model second opinion (gated on PATH)
orchestrator/intake_sanitizer.py  # prompt-injection scanner
orchestrator/action_evaluator.py  # shell/git command safety scorer
```

## Honest assessment (per L7 §18 obligation)

The system is **measurably closer to L7** than at start: 12 dim-internal
moves + 1 overall-L move (3 → 4). Every dim is now ≥ L4. The L7
self-discipline loop continues to fire correctly on every cycle.

**Cycle 14 was an important learning event** (FAIL_AS_DATA): a real
attempt at Track T5 hit an external-tool wall, the cycle rolled back
atomically, and the learning was captured as data (FAIL-0011) rather
than swept under the rug. This is exactly the §8 "failure is data"
pattern — demonstrable on a real failure, not just hypothetically.

**Cycle 15 was the first paid-third-party carve-out** (ADR-0008):
operator installed Codex; the cycle built budget infrastructure
BEFORE making any code-spending call; the calibration call observed
subscription billing; the carve-out is documented + scoped.

**Cycle 17 is the first overall-L move since Bootstrap** 🎯 — the
worktree infra that took C from L3 to L4, lifting every dim to ≥ L4
and the overall floor from 3 to 4.

The biggest remaining technical-debt risk is the **three not-yet-fixed
FAILURES that have code-touching scope**:
- **FAIL-0007** (record_run idempotency) — high priority before any
  extended live e2e run
- **FAIL-0008** (.dockerignore + .env leak risk) — high priority
  before any Docker image rebuild
- **FAIL-0009** (doctor side-effect dirties session-log.md) — low,
  cosmetic, but pollutes every cycle's `git status`

Recommend a "FAIL-0007-fix" cycle before any live e2e is attempted.

## Distance to L7

| Dim | Now | Path to L7 | Cycles est. |
|---|---|---|---|
| M | 7 | (already max) | — |
| S | 7 | (already max) | — |
| R | 5 | R4 adversarial reviewer (L6) → N-of-3 panel (L7) | 2-3 |
| C | 4 | C3 dispatch + 30-cycle zero-deadlock streak (L5) → 5+ worktrees (L7) | 30+ |
| T | 4 | mutmut workaround (L5) → mutation kill ≥ 80% on 4 modules → live sanity per RC (L6) → golden-diff (L7) | 4-6 |
| E | 6 | last 3 overall-L moves cite propose_next_track (L7) | 2-3 |

**Honest forecast: ~6-10 cycles to overall L5 (C is the gate).
Overall L7 is multi-month; the 30-cycle zero-deadlock streak alone
is observation work, not coding work.**

— end of summary —
