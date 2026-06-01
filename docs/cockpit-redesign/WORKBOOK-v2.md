# Cockpit Redesign Workbook — v2 · "Agentic Cowork"

> **Status: DRAFT — awaiting operator approval.** No implementation has started.
> Supersedes the direction in [`WORKBOOK.md`](./WORKBOOK.md) (v1 · "Codex Classic"),
> which was a shell + design-system reskin. v2 is a behavioral redesign: the cockpit
> stops being a form-with-panels and starts behaving like a real agent workbench
> (Claude Code / Cowork style).
> Target: `apps/dashboard` (front) + `packages/daemon` operator layer (back).
> Core architecture ([ADR-0010](../adr/0010-three-plane-event-sourced.md): TS daemon +
> event-sourced log + three planes) is **kept**; we rebuild the operator API surface and
> the cockpit page on top of it.

---

## 0. Why v2 (what v1 got wrong, verified against the tree)

A code audit of the current cockpit confirmed six operator complaints:

| # | Complaint | Verified root cause (file:line) |
|---|-----------|---------------------------------|
| 1 | "Clarify before I plan" feels like a **preset template**, not real analysis | ✅ True. Questions come from a hardcoded `QUESTION_BANK` in [`clarification-gate.ts:152`](../../packages/daemon/src/clarification-gate.ts), selected by a **regex** ambiguity scorer (`scoreAmbiguity()`, [`:108`](../../packages/daemon/src/clarification-gate.ts)). No LLM analyzes the goal/repo. `operatorQuestionsFor()` ([`operator.ts:434`](../../packages/daemon/src/routes/operator.ts)) just maps templates. |
| 2 | After **Generate**, no inline Approve/Start appears | ✅ True — but the cause is **fragility, not a missing status** (corrected after closer reading). The backend *does* drive mission → `pending_approval` (`intake.requestApproval`, [`operator.ts:185`](../../packages/daemon/src/routes/operator.ts)). The coach-card Approve/Start branches gate on the **async, nullable `overview.mission.status`** ([`Cockpit.tsx:568`](../../apps/dashboard/src/pages/Cockpit.tsx)/`:576`), but `overview` is fetched only `if (x.mission)` *after* Generate ([`:377`](../../apps/dashboard/src/pages/Cockpit.tsx)). Until it loads — or if the planner HOLDs or the fetch fails — the card falls through to a **no-button "Monitor" default** ([`:637`](../../apps/dashboard/src/pages/Cockpit.tsx)). Root cause: decisions are gated on nullable `overview` instead of the always-present `session.status`. Compounded by: `OperatorSessionStatus` is **untyped loose strings** while `MissionStatus` is a typed enum + state machine — two overlapping fields, no shared contract. |
| 3 | Approval shows in the **right inspector**, not the running thread | ✅ By (bad) design. Approve/Start/Draft-PR live in the inspector Roadmap tab ([`Cockpit.tsx:410`](../../apps/dashboard/src/pages/Cockpit.tsx), `:414`); ApprovalCard in the approvals tab (`:436`). |
| 4 | **Draft PR** click dead-ends | ✅ `allow_remote_writes` defaults `false`, so [`operator.ts:283`](../../packages/daemon/src/routes/operator.ts) returns `{status:'blocked'}` (HTTP 200); UI shows one grey line. No success path, no remediation guidance. |
| 5 | Right side should look like **Cowork** (Progress / Working folder / Context) | Design directive. Current right side = 5-tab inspector. |
| 6 | Clarify popup should be **LLM-generated from real context** and a **bottom, blocking, non-bypassable** modal | Current = template + dismissable inline chips. |
| 7 | "daemon not started → HTTP 500" must be killed **for good** | ✅ Daemon has no self-heal/reconnect. Prod relies on launchd; dev on a foreground script. A frontend-only start (no `:7247`) surfaces as a Vite-proxied 500. |

---

## 1. Locked decisions (from the 2026-05-31 brainstorm)

1. **Clarify = adaptive agentic loop.** A planner brain reads `{goal, repo snapshot}` and asks questions **one-or-few at a time, across multiple rounds, until it is confident** — exactly like Claude Code. The regex `QUESTION_BANK` path is retired.
2. **Right panel = pure Cowork observation** (Progress / Working folder / Context). **All actions** (clarify answer, approve, start, pause/resume, Draft PR) move **out of the right inspector** into the conversation flow / bottom composer zone — inline and blocking at the decision moment. Creative placement encouraged; the right panel becomes read-only situational awareness.
3. **Daemon self-heal.** The frontend detects daemon-down and **auto-starts** it (see §2.4 for the honest mechanism — a browser can't spawn a process, so a tiny local supervisor is required).
4. **E2E target = a real Draft PR on a real repo.** The full loop (brainstorm → adaptive clarify → roadmap → approve → **Docker execution** → **real Draft PR**) must run against `CTlanston/hermus-agent`. This requires solving the known Docker-runner + `CLAUDE_CODE_OAUTH_TOKEN` blockers and enabling `allow_remote_writes` for that repo — under all existing approval gates.

## 1a. Assumptions (please confirm or correct in review)

- **A1 — Core kept.** ADR-0010 daemon + event-sourced log + three planes stay. We rebuild the *operator API layer* and the *cockpit frontend* only.
- **A2 — Brains.** Planner/clarify loop runs on the **local Claude CLI** (repo default `auth_mode: local_claude_code`), with **Codex CLI as configured fallback**. Execution = **Claude-in-Docker** worker. (The cockpit dev script currently forces `planner=codex`; v2 makes the brain explicit + visible in the UI.)
- **A3 — Target repo.** Real E2E runs against **`CTlanston/hermus-agent`**. It must be registered in `repos.yaml` (`enabled: true`), with `forbidden_paths` defaults intact (`.env*`, `secrets/**`, `.github/**`, `CLAUDE.md`, `AGENTS.md`).
- **A4 — Safety gates unchanged.** `allow_remote_writes` flips to `true` for `hermus-agent` **only at the real-PR phase (P5)** and the PR creation still passes the medium/high-risk approval policy. No silent API fallback. Forbidden paths enforced. These CLAUDE.md non-negotiables are **not** relaxed by this redesign.

---

## 2. System design (front + back)

### 2.1 The new operator experience (narrative)

```
┌─ top strip (kept, slim): daemon · brain(provider) · runs · tokens · cost · repo · approvals ─┐
├───────────┬────────────────────────────────────────────────┬───────────────────────────────┤
│ History   │  CONVERSATION (the agent workbench)             │  OBSERVATION (Cowork-style)   │
│ grouped   │   • your goal                                   │   ▸ Progress   ●─●─○ steps    │
│ by repo   │   • agent: "reading repo…" (collapsed process)  │   ▸ Working folder  repo+files│
│ (kept,    │   • ADAPTIVE CLARIFY — blocking popup at bottom │   ▸ Context  tools/files used │
│  collapse)│   • roadmap summary inline                      │                               │
│           │   • INLINE ACTION step: [Approve] [Start] …     │   (read-only situational      │
│           │   • run output + evidence + Draft PR result     │    awareness — no buttons)    │
│           │  ── composer (goal / answers / actions dock) ── │                               │
└───────────┴────────────────────────────────────────────────┴───────────────────────────────┘
```

The center is a true thread. Decisions happen **where you're looking** (center/bottom), blocking. The right panel only *shows* state.

### 2.2 Backend changes (`packages/daemon`)

- **B1 — Clarify Agent (replaces the template gate).** A new agentic loop:
  `clarify.tick(session)` → builds context `{goal, repo file tree + key files, prior Q&A}` → calls the planner brain with a tool-style contract: *"either ask the next 1–3 questions, or declare ready-to-plan."* → persists the decision as events → waits for operator answers → repeats. Hard caps: max rounds (e.g. 4), max questions/round (3), timeout. Retire `QUESTION_BANK` as the *source*; keep a tiny fallback only if the brain is unreachable.
  New events: `operator.clarify.questions_asked`, `operator.clarify.answered`, `operator.clarify.satisfied`.
- **B2 — Status vocabulary unification (fixes #2).** One shared TS status enum in `packages/core`, imported by both daemon and dashboard. Make the approve gate a *real* state (`roadmap_ready → pending_approval → approved`) so the inline Approve step exists and matches end-to-end. Add a typed contract test that fails if front/back diverge.
- **B3 — Real Draft PR + honest outcomes (fixes #4).** Wire `executor.openDraftPr` to real GitHub for the enabled repo; emit `operator.draft_pr_created` with the **PR URL + checks**, or `operator.draft_pr_blocked` with a **machine-readable reason + remediation**. The UI renders success as a PR card and blocked as an actionable next step — never a silent grey line.
- **B4 — Daemon supervisor + control endpoint (fixes #7, see §2.4).**

### 2.3 Frontend changes (`apps/dashboard`)

- **F1 — Three-zone agent layout.** Left history (kept, repo-grouped, collapsible). Center conversation. Right = Cowork observation panels.
- **F2 — Adaptive clarify popup.** Bottom-anchored, **blocking, non-bypassable** modal driven by `operator.clarify.*` events: numbered options + "reply directly" free-text + ↑/↓ navigate + Enter select (mirrors Cowork's pattern). It appears only when the agent asks, and it gates the composer until answered.
- **F3 — Inline action dock (fixes #3).** Approve / Start / Pause / Resume / Draft PR render **inline in the thread at the decision moment** and/or in a composer-adjacent action dock — blocking, contextual. **Removed from the right panel.**
- **F4 — Cowork observation panels (#5):**
  - **Progress** — the roadmap/run as a step dot-timeline (maps to `operator.stage_changed` + task DAG + `runProgress`).
  - **Working folder** — the repo + workspace + files the run touched (maps to artifacts + diff).
  - **Context** — tools and referenced files used this mission (maps to the event log).
- **F5 — Daemon-offline UX.** Detect `:7247` down → banner → auto-call the local supervisor to (re)start → reconnect the event stream. The 500 becomes a transient self-healing state.

### 2.4 Honest mechanism for "frontend auto-starts the daemon"

A browser tab **cannot** spawn an OS process. So the faithful implementation of decision #3 is:

- A **tiny always-on launchd supervisor** (separate from, and far lighter than, the heavy daemon) that exposes a **localhost-only** control endpoint (`POST /supervisor/ensure-daemon`).
- The dashboard's offline banner calls that endpoint; the supervisor runs `launchctl kickstart` (or spawns `packages/daemon`) and reports back.
- Dev parity: the same supervisor (or the existing `dev-operator-cockpit.ts`, upgraded) guarantees `:7247` before serving the UI.

This honors "frontend detects → auto-starts" while being technically real and secure (localhost-bound, no remote control surface). **Confirm** you're OK with one tiny extra always-on process; the alternative (serve the dashboard *from* the daemon as a single process) is noted as a fallback if you'd rather not add a supervisor.

---

## 3. Phase-to-phase plan (each phase = TDD, small commits, guardian-reviewed, gated; each has a verifiable exit)

| Phase | Goal | Exit criterion (verifiable) |
|-------|------|------------------------------|
| **P0 · Truth-up** | (a) Make the coach-card decision (Generate→Approve→Start) key off the always-present `session.status`, not the nullable async `overview` (robust fix for #2); (b) add a typed `OperatorSessionStatus` in `packages/core` (mirror `MissionStatus`) + adopt it front+back. (Registering `hermus-agent` is deferred to P5, when the repo is cloned locally.) | Unit test proves inline **Approve appears after Generate with `overview=null`**; status vocabulary is typed; all dashboard tests stay green; `tsc --noEmit` clean. |
| **P1 · Daemon never-down** | Supervisor + localhost control endpoint + frontend offline→autostart→reconnect (§2.4). | Kill `:7247`, reload the dashboard → it auto-recovers with no manual command. The "HTTP 500 / daemon disconnected" path is no longer reachable from a normal start. |
| **P2 · Cowork shell** | New 3-zone layout; right = Progress/Working folder/Context wired to existing events/overview; left history kept; actions temporarily inline. | Vite preview screenshots match the Cowork structure; **all dashboard tests green**; other tabs (Missions/Tasks/Approvals/Memory) render unchanged. |
| **P3 · Adaptive clarify agent** | Replace the template gate with the agentic loop (B1) + the blocking bottom popup (F2). | A real goal on `hermus-agent` yields **context-specific** questions (proven against the event log, not the QUESTION_BANK) and adapts across ≥2 rounds; popup blocks until answered; caps honored. |
| **P4 · Inline action flow** | Approve/Start/Pause/Resume/Draft-PR inline & blocking (F3); honest Draft-PR outcomes (B3); remove actions from the right panel. | A full click-through brainstorm→clarify→roadmap→approve→start runs with every step inline; no action lives in the right panel; blocked Draft-PR shows a remediation, not a dead end. |
| **P5 · Real execution → real PR** | Solve Docker runner (`runner:latest`) + `CLAUDE_CODE_OAUTH_TOKEN`; enable `allow_remote_writes` for `hermus-agent`; real worker runs in Docker and opens a **real Draft PR** with evidence; PR URL surfaced inline. | A real Draft PR appears on `github.com/CTlanston/hermus-agent`, created from a cockpit-driven mission, **gated by the approval policy**. |
| **P6 · E2E proof & hardening** | One scripted E2E driving the whole loop (extend `scripts/operator-cockpit-*.ts`); evidence captured; reconnect/soak tested. | `pnpm test:cockpit:e2e` (or a new script) goes green end-to-end and writes an evidence doc under `evidence/launch/`. |

**Sequencing logic:** P0/P1 are foundations (correctness + the bug you want killed first). P2 makes it *look* right. P3/P4 make it *behave* right (your core complaints). P5 is the heavy, blocker-laden "real PR" milestone — isolated last so the experience is already proven before we fight Docker/token. P6 locks it.

---

## 4. Non-goals / guardrails (unchanged from repo policy)

- No edits to `.env`, `secrets/**`, SSH/keychain, or any forbidden path.
- `allow_remote_writes` stays `false` everywhere except `hermus-agent` at P5, and only then under the approval policy.
- No silent API fallback; the brain (Claude/Codex/API) is explicit and logged.
- No legacy `archive/auto-evo/` imports; no event-schema rewrite of the core (additive events only).
- Other dashboard tabs stay visually and behaviorally untouched.

## 5. Open risks / unknowns (flagged honestly)

- **R1** — "Frontend auto-start" needs the tiny supervisor (§2.4). If you reject the extra process, fallback = daemon serves the dashboard as one process.
- **R2** — P5 depends on the OAuth-token blocker (keychain 401s / `claude setup-token`). If it can't be solved, P5 falls back to a *staged* real-PR (manual token paste) and we flag it.
- **R3** — Adaptive clarify loop adds LLM latency/cost per round; mitigated by caps + caching the repo snapshot.
- **R4** — Real PR creation is irreversible/outward-facing; every P5 run is approval-gated and announced.

## 6. What I need from you before P0

1. Confirm the **§2 right-panel/inline-actions** reading (decision #2) and the **§2.4 supervisor** approach (or pick the single-process fallback).
2. Confirm **A2 brain** (Claude-local + Codex fallback) and **A3 target repo** = `hermus-agent`.
3. Confirm you accept **P5 enabling `allow_remote_writes` for `hermus-agent`** (real PRs to your repo).

On your approval, I start at **P0** and work phase-by-phase, verifying each exit before moving on.
