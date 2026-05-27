# NEXT_PLAN_WORKBOOK · claude-code-247

> **Successor to `EXECUTION_WORKBOOK.md`.**
> Operating philosophy: **30-minute smoke test → LAUNCH → fix in flight**.
> Not 30-day pre-flight soak. The operator is the only user; the blast radius is one machine; the cost of being wrong is "fix a bug tonight", not "page 10,000 customers". That changes the entire risk calculus.
> Same discipline as before on what we *do* check: §1 GROUND RULES carry over verbatim, every phase exit still needs L1+L2+L3, evidence still required. We are not lowering the bar on quality — we are moving the soak *into production* instead of *before production*.

---

## §0 · STATE

```yaml
schema_version: 2
parent_workbook: EXECUTION_WORKBOOK.md
parent_completion: stage-class complete (20/20 L1+L2+L3 pass, v2.2.0 on main)
plan_version: NEXT-2
operating_mode: launch-fast               # vs. soak-first
current_phase: L0                         # L0 L1 L2 L3
current_substage: L0.L3-operator-confirmation-required
last_updated_utc: 2026-05-27T20:34:09Z
last_session_id: next_s0001
total_sessions: 1
weeks_remaining_next: 5                   # was 12, now 5
open_holds: 0
blocked_on: null
next_action: |
  Phase L0 smoke harness has run 7/7 LAUNCH_AUTHORIZED on main commit f86531d
  and evidence is in evidence/launch/smoke-2026-05-27T20-33-55-220Z.{json,md}.
  Codex also prepared evidence/launch/operator-launch-signoff.md and
  day-1 through day-7 L1 journal files.

  Current blocker: true phone/operator paths are not yet healthy enough to
  claim L0 L3 PASS. TS daemon /status is running, but /approvals, /missions,
  /tasks, and /repos are empty; legacy claude247 launchd jobs fail with
  ModuleNotFoundError: gateway; legacy dashboard /status-board.json returns
  HTTP 500. Next: decide RoadmapAgent cadence (daemon-owned vs launchd),
  restore/build a healthy phone approval + HOLD resolution entrypoint, then
  have Lanston confirm the two real phone actions in operator-launch-signoff.md.
risk_acknowledgements:
  # The operator has explicitly accepted these trade-offs vs. a long soak.
  - "Rare failure modes (month-boundary, real CLI version bump, sustained quota near-ceiling) may surface in flight; recovery is the operator's responsibility."
  - "Alerting was proven to deliver under wifi; cellular and 3am responsiveness are not pre-validated."
  - "Cost ceiling is set high (see L1) but a runaway billing scenario could still happen on day 1."
  - "Production data is the soak data. There is no 'staging' equivalent."
sla_after_launch:
  # SLAs become 'targets to monitor in production', not 'gates to launch'.
  # Each carries a budget — if breached, an ADR explains what we change.
  smoke_pass_rate: { target: 1.00, gates: launch }
  daemon_uptime_pct_7d: { target: 99.0, post_launch_review: 1w }
  autonomous_pr_success_rate_7d: { target: 0.5, post_launch_review: 1w }
  cost_per_autonomous_pr_usd_7d: { target: 8.0, post_launch_review: 1w, hard_cap: 15.0 }
  sentinel_false_block_rate_7d: { target: 0.05, post_launch_review: 1w }
  hold_mttr_p95_min_7d: { target: 30, post_launch_review: 1w }
```

---

## §1 · GROUND RULES (inherited, plus two launch-mode additions)

All 10 GROUND RULES from `EXECUTION_WORKBOOK.md §1` carry over **verbatim**.

11. **Smoke pass is binary.** 7/7 of §3 L0 checks pass on a single clean boot → launch is authorized for the same day. 6/7 → fix and re-run; partial credit is not credit.
12. **Hard cost cap is non-negotiable.** §0 `cost_per_autonomous_pr_usd_7d.hard_cap` is the daemon-side circuit breaker. Crossing it auto-pauses RoadmapAgent and creates a `HOLD-cost-cap-breached`. Operator may raise the cap only with an ADR.

These two carry the operator's explicit decision to launch fast.

---

## §2 · THE TRADE-OFF (read this before launch)

The operator has chosen `launch-fast` over `soak-first`. The honest comparison:

| Dimension | soak-first (4w pre-flight) | launch-fast (30-min smoke) — **chosen** |
|---|---|---|
| Time to first real value | week 5 | day 1 |
| Confidence in rare failures pre-launch | medium | low |
| Confidence in core happy path pre-launch | high | high (smoke covers it) |
| Cost of a day-1 bug | low (caught pre-launch) | medium (caught in flight; ≤1 user affected) |
| Alerting validated in real conditions | yes, before users | no, validated *during* users |
| Iteration loop | slow (waiting for soak data) | fast (real telemetry from day 1) |
| Risk profile fit | multi-tenant SaaS | **single-operator personal infra** ← our case |

**What this workbook is NOT giving up:**
- Quality bar on shipped code (still L1+L2+L3, still ADRs, still red-team passing)
- Evidence trail (still required, just collected post-launch instead of pre-launch)
- Rollback capability (Stage M from EXECUTION_WORKBOOK still applies — feature flag flips work)

**What this workbook IS giving up:**
- Multi-day pre-flight reassurance
- The ability to claim "production-grade by industry definition" before any actual production
- A clean "we knew before users did" story for any incident in the first week

If the operator decides at any point that these trade-offs are wrong, they revert to `NEXT_PLAN_WORKBOOK.md @ NEXT-1.0` (in git history) and run the long soak instead. Both versions are valid.

---

## §3 · PHASE PLAYBOOK

Four phases over 5 weeks (was 12). Same shape as before: **Goal / Inputs / Deliverables / L1 / L2 / L3 / Exit**.

### Phase L0 — 30-Minute Smoke + Launch · 1 day

**Goal** A scripted 30-minute end-to-end smoke test. 7/7 green = launch the same day. No multi-day rehearsal.

**Inputs** v2.2.0 on `main`; operator phone configured; real ntfy + Tailscale ready.

**Deliverables**
- `scripts/launch-smoke.ts` — orchestrates the 7 checks in sequence
- `evidence/launch/smoke-<UTC>.json` — machine-readable result
- `evidence/launch/smoke-<UTC>.md` — human-readable summary with timings
- `docs/adr/0015-launch-fast-mode.md` — documents the trade-off and the operator's acceptance
- §0 `current_phase` → L1 if 7/7 pass

**The 7 smoke checks** (each must complete within its window)

| # | Check | Window | Pass criterion |
|---|---|---|---|
| 1 | Cold boot daemon + dashboard | 60s | `health.green=true` within 60s |
| 2 | One real mission: RoadmapAgent reads `roadmap.md`, emits ≥1 proposal | 5 min | proposal event emitted with valid `mission_spec` |
| 3 | Operator approves the proposal from phone (real ntfy → real tap) | 5 min | `approval.granted` event within window |
| 4 | Mission runs to PR: Planner → 2 Coders (fan-out=2 is enough) → Reviewer → cap-token push → PR open | 10 min | PR URL surfaces in event log; HEAD sha matches commit sha |
| 5 | Red-team inject: 1 prompt-injection in mid-mission tries forbidden write | within step 4 | sentinel emits `hard-block`; no forbidden write occurs |
| 6 | Force a HOLD (kill 1 session in the pool) → operator sees ntfy → resolves from phone | 5 min | `hold.resolved` within window; pool back to N |
| 7 | Telemetry triple-check: 1 event from above appears in SSE + Prometheus + Loki with identical id | 2 min | grep returns ≥1 hit in each plane |

**L1 Acceptance** 7/7 pass; total wall-clock ≤ 30 min; `smoke-<UTC>.json` validates schema.

**L2 Review** Reviewer agent reads `evidence/launch/smoke-<UTC>.*` + raw event slice; recomputes timings; flags any window violation.

**L3 Validate** Operator clicks "I have read §2 trade-offs and accept" in `docs/adr/0015` and signs `evidence/launch/operator-launch-signoff.md`.

**Exit → L1** Same day, `mesh.enabled=true` stays on, RoadmapAgent cron stays on, real missions start. **No further pre-flight gates.**

**If 6/7 or less** Fix the failing check, re-run full smoke (not partial). Three consecutive failed smokes → operator decides whether to revert to NEXT-1.0 long-soak mode.

---

### Phase L1 — Live Fire · 7 days

**Goal** First week of unattended operation. The "soak" the long-form workbook deferred to pre-launch happens here, in production.

**Inputs** Live daemon serving real missions. Operator on call.

**Deliverables**
- `evidence/launch/day-1.md` through `day-7.md` — one short journal per day (≤200 words; 5 minutes to write)
- `evidence/launch/week-1-report.md` — auto-generated from event log + journal at end of day 7
- Any incident: `evidence/launch/incident-NNNN.md` within 24h
- §0 `sla_after_launch.*` measured from real telemetry

**L1 Acceptance** (measured from real 7-day window; gentler than 30-day version)
- daemon uptime ≥ 99.0% (allows ~100min downtime in 7d)
- ≥ 3 missions complete end-to-end (proves not a one-shot fluke)
- ≥ 1 sustained `auto-resolved HOLD` cycle without operator intervention
- 0 cost-cap breaches; cost trend < hard_cap
- 0 events with `idempotency` collisions
- ≥ 1 cap-token rejection actually fires under real conditions (not a synthetic)

**L2 Review** Reviewer agent reads only the 7-day event slice and the auto-generated report (not the journal). Reproduces each SLA ± 5%. Output: `docs/reviews/L1-week1-review.md`.

**L3 Validate** Operator answers 4 questions in the week-1 report:
1. Did the daemon surprise you in a bad way? (Y/N + one line)
2. Was the cost within expectation? (Y/N + actual $)
3. Was every phone notification useful? (Y/N + count of noise)
4. Did trust in the system grow or shrink this week? (↑ / ↓ / =)

**Exit → L2** If L1 acceptance is met → proceed. If 1 SLA misses → ADR + continue. If ≥ 2 miss → pause L2, write an incident review, decide whether to roll back to `mesh.enabled=false`.

**Pitfalls**
- Don't tune config mid-week to "help" a metric — that resets the 7d clock.
- Cellular alerting almost certainly *will* miss something; that's data, not failure. Log it.

---

### Phase L2 — Operational Maturity · 3 weeks (parallel substages)

Same content as the previous NEXT-1.0 P2, scoped tighter because live data already exists.

#### L2.1 — Cost Observability · 1w

- `packages/cost-meter/src/{tagger,roller,exporter}.ts`
- New gauge `cost_per_pr_usd_7d`; alert at 80% of hard cap
- **L1** Tag rate 100% on cost-bearing events; daily sum ± 10% of Anthropic bill
- **L2** Reviewer reconciles 1 day vs. bill
- **L3** Operator reads cost dashboard for 1 week; no surprises

#### L2.2 — SLO Dashboard + Alerting · 1w (parallel)

- Single Grafana page rendering §0 `sla_after_launch.*`
- Alert routes: `cost`, `hold-overrun`, `redteam-leak`, `uptime`
- **L1** Trip each alert via synthetic; fires within 60s
- **L2** Reviewer audits thresholds vs. §0 targets
- **L3** Operator confirms 1 week of alerts is actionable, not noisy

#### L2.3 — Hotfix Discipline · 0.5w (parallel)

- First real hotfix process (`v2.2.1`)
- `docs/operations/hotfix-playbook.md`
- **L1** Hotfix follows ADR-0014 §template; ≤8h soak before tag (live-fire mode shortens this)
- **L2** Reviewer audits deviation
- **L3** Operator confirms tag + release notes

#### L2.4 — Second-Machine Standby · 0.5w (parallel)

- Linux box gets v2.2.x installed via `scripts/handoff/secondary-install.sh`
- Cold standby — not active, but ready
- **L1** Install completes; daemon boots; smoke from L0 passes on Linux
- **L2** Reviewer runs install on fresh VM
- **L3** Operator confirms standby can be activated in <30 min if primary fails

**Phase L2 Exit → L3** All 4 substages closed; SLO dashboard live; hotfix path proven; standby ready.

---

### Phase L3 — v2.3 Spike · 1 week

**Goal** Same as before — decide what's next with discipline — but tighter scope because the launch-fast operator's appetite is for action, not exploration.

Operator picks **exactly 1** theme:

| Theme | Why it matters |
|---|---|
| **Persistent memory across missions** | RoadmapAgent currently re-discovers context every cycle |
| **Multi-repo missions** | Today bound to 1 repo |
| **Operator-as-Reviewer in-loop** | L3 is async; spike sync review for critical missions |
| **Sentinel model tier-down** | M4 uses Haiku always; spike risk-class router |

**L1** Spike lives on `spike/<theme>`; ADR + smallest-possible-proof; **does not merge to main**

**L2** Reviewer scores feasibility / cost / risk / surface-area; recommends ship or shelve

**L3** Operator decides; if ship → starts a NEXT_NEXT workbook with this theme as Stage A

**Exit** Decision recorded in `docs/adr/0020-v2-3-scope.md` (or `0020-maintenance-mode.md`). NEXT_PLAN_WORKBOOK closes.

---

## §4 · SLA RECONCILIATION RULE (relaxed for launch-fast mode)

For an SLA to transition `open` → `closed`:

1. Real telemetry artifact in `evidence/sla/<name>/`
2. Reviewer agent reproduces the math ± 5%
3. **Minimum window: 7 days** (was 14 in NEXT-1.0)
4. The §0 entry's `source` field references the artifact path
5. Transition logged in §8 and §9

Two SLAs always require **30-day windows** regardless of mode (these don't shorten safely):
- `daemon_uptime_pct_30d`
- `cost_per_autonomous_pr_usd_30d`

These remain `open` until day 30 minimum. Everything else can close at day 7.

---

## §5 · INHERITED CONTRACTS

Unchanged from EXECUTION_WORKBOOK.md:
- §1 GROUND RULES (extended by §1 above)
- §2 SESSION PROTOCOL
- §4 CROSS-CUTTING STANDARDS
- §5 L1 / L2 / L3 three-tier contract
- §6 EVIDENCE package format
- §7 UPDATE PROTOCOL
- §8 ESCALATION & HOLD

Conflict resolution: this workbook wins for post-GA work in launch-fast mode.

---

## §6 · EVIDENCE LAYOUT (delta)

```
evidence/
├── launch/                       # L0 + L1
│   ├── smoke-<UTC>.json
│   ├── smoke-<UTC>.md
│   ├── operator-launch-signoff.md
│   ├── day-1.md ... day-7.md
│   ├── week-1-report.md
│   └── incident-NNNN.md
├── sla/                          # one folder per SLA in §0
│   ├── daemon_uptime_pct_7d/
│   ├── cost_per_autonomous_pr_usd_7d/
│   └── ...
└── spikes/                       # L3
    └── <theme>/
```

---

## §7 · DECISION GATES

### Gate G1 — End of L0 (launch day)

7/7 smoke pass → launch authorized. 6/7 or less → fix and re-run; 3 consecutive fails → revert to NEXT-1.0 long-soak mode.

### Gate G2 — End of L1 (day 7)

If ≥ 4/6 acceptance bullets met → proceed to L2. If 2 or 3 missed → ADR + continue cautiously. If ≥ 4 missed or any incident with operator data loss → pause; consider rollback to `mesh.enabled=false` and run a longer soak.

### Gate G3 — End of L3 (week 5)

v2.3 scope decided OR operator declares maintenance mode.

---

## §8 · SESSION LOG (append-only, **newest on top**)

#### next_s0001 — 2026-05-27T20:34:09Z — L0 smoke evidence prepared

- phase_in: L0.0 → phase_out: L0.L3-operator-confirmation-required
- l1: launch-smoke 7/7 LAUNCH_AUTHORIZED on main commit f86531d
- l2: not_run
- l3: prepared only; Lanston signature required
- evidence:
  - `evidence/launch/smoke-2026-05-27T20-33-55-220Z.json`
  - `evidence/launch/operator-launch-signoff.md`
  - `evidence/launch/day-1.md`
- notes:
  - Codex fixed launch-smoke timeout cleanup before the final smoke run so
    the CLI exits normally after writing artifacts.
  - The current real-mode CLI still binds to `syntheticChecks()`. Do not
    treat the smoke artifact as proof of a true phone tap or real HOLD
    resolution until Lanston confirms those operator-only actions.
  - Follow-up local checks found no pending TS daemon approvals/missions/tasks,
    no standalone RoadmapAgent launchd job, and unhealthy legacy Python
    launchd jobs after the F3 cutover. L0 remains blocked on a healthy real
    phone/operator path.

#### s_0001 — placeholder (not yet started)

- phase_in: — → phase_out: —
- l1: — · l2: — · l3: —
- next_action: see §0
- notes: NEXT_PLAN_WORKBOOK rewritten 2026-05-27 to launch-fast mode at operator's direction. Replaces the 12-week NEXT-1.0 plan with a 5-week plan: 30-min smoke → launch same day → 7-day live fire → 3w maturity → 1w spike.

---

## §9 · DOCUMENT CHANGELOG

| Date | Version | Change | By |
|---|---|---|---|
| 2026-05-27 | NEXT-1.0 | Initial 12-week soak-first plan (P0–P3) | architect |
| 2026-05-27 | NEXT-2.0 | **Rewrite to launch-fast: 30-min smoke + same-day launch + 7d live fire. Trade-offs documented in §2.** Operator-directed. | architect |
| 2026-05-27 | NEXT-2.1 | L0 smoke evidence prepared; launch-smoke timer cleanup; operator signoff/day-1 files prepared without forging Lanston signature. | codex |

---

## §10 · QUICK ANSWER

**"Why 30 minutes instead of 30 days?"**
Single operator, single machine, one user (you). Blast radius = your own day. The cost of a day-1 bug is "fix it tonight", not "page 10,000 customers". 30-day soak is the right answer for a multi-tenant SaaS; it is overkill for personal infra. We replaced it with a tight 30-minute smoke that genuinely proves the happy path, then we soak *in production* with you on call.

**"What's the bar to launch?"**
**7/7 green on a single clean smoke run** (§3 L0 table). Binary. Same day.

**"What's the bar to keep flying after week 1?"**
**4/6 acceptance bullets met** (§3 L1) + no incident with data loss. If you slip below that, the workbook tells you to pause and reconsider — not to keep pushing.

**"What did we give up?"**
The ability to say "we proved it pre-launch". We did not give up: code quality, evidence trail, rollback capability, ADR discipline. (See §2 for the full table.)

**"What's the one rule that matters?"**
GROUND RULE 12 — hard cost cap. If we get billing surprises, that's the line we will not cross. Everything else is recoverable.
