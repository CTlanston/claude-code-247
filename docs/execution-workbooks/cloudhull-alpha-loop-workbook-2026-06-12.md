# CloudHull Alpha Loop Workbook

> Created 2026-06-12 for the post-c0..c7 local-alpha hardening loop.
> Primary PR: https://github.com/CTlanston/claude-code-247/pull/54
>
> This workbook is for Claude Code to consume after PR #54 is reviewed/merged by
> the operator. It must not auto-merge PR #54 or any follow-up PR.

---

## 0. STATE

```yaml
schema_version: 1
cycle: cloudhull-local-alpha
source_pr: 54
source_branch: claude/cloudhull-alpha
current_phase: ALPHA-GATE
last_local_check_utc: 2026-06-12T08:41:26Z
open_holds: 3
blocked_on:
  - operator_claude_login_headless
  - operator_dual_device_walkthrough
  - real_clock_one_week_soak
completed_local_evidence:
  gemini_synthetic_gate: evidence/f0-gemini-gate/2026-06-12T08-40-49-328Z/REPORT.md
  real_smoke_safety: evidence/launch/operator-cockpit-real-smoke-2026-06-12T08-41-13-974Z.md
  strict_real_smoke_blocked: evidence/launch/operator-cockpit-real-smoke-2026-06-12T08-41-22-473Z.md
next_action: |
  First clear operator_claude_login_headless by running /login in the local
  Claude Code interactive CLI, then prove `claude -p` works. After that rerun
  strict real-smoke with P1+Gemini requirements enabled. Do not substitute
  Anthropic API fallback for local subscription login.
```

---

## 1. Mission

Move CloudHull from "code side ready for 5-6 trusted local-alpha users" to
"operator-proven local alpha can run safely for one week."

The product promise for this phase:

- trusted users can open the cockpit on the Tailscale LAN;
- each user enters their name and submits requests;
- clarification, five-card default, observation, and audit attribution work;
- approve/start/create-pr remain operator-only;
- owner protection and no-auto-merge remain intact;
- validators and evidence never report fake success;
- one-week soak runs with zero safety violations.

---

## 2. Ground Rules

- Do not auto-merge PR #54. The operator must merge it manually or explicitly
  instruct a gated merge after reviewing current checks.
- Do not push, merge, or call GitHub write APIs unless repository policy gates
  are satisfied and the operator explicitly approves that write.
- Do not edit `.env`, `secrets/**`, SSH keys, keychain, production credentials,
  `.github/**`, or `AGENTS.md`.
- Do not silently switch local Claude Code execution to paid Anthropic API
  fallback. If local Claude headless auth fails, HOLD.
- Treat a report as evidence only when backed by persisted files, logs,
  validator records, browser screenshots, or real-time soak records.
- One-week soak cannot be compressed and called complete. A compressed or dry
  soak may be useful rehearsal evidence, but it does not close the real-clock
  HOLD.

---

## 3. Current Reality Snapshot

PR #54 status observed locally on 2026-06-12:

- state: open draft;
- merge state: clean;
- head: `claude/cloudhull-alpha`;
- base: `main`;
- checks: `typecheck-lint-test`, `gitleaks`, `semgrep`, and
  `redteam-round3` all successful;
- remote writes config on this Mac: `system.allow_remote_writes: false`.

Local evidence produced on 2026-06-12:

- Gemini synthetic gate passed with real API: good bundle `pass`, bad bundle
  `fail`.
- Non-strict real smoke passed safety invariants with remote writes disabled,
  but reached planner HOLD before execution.
- Strict real smoke failed honestly:
  `P7 strict mode: planner did not reach 95% understanding (status=hold)`.
- Direct headless Claude probe failed with `401 Invalid authentication
  credentials`; interactive Claude Code displayed "Please run /login".

Therefore, only the Gemini synthetic artifact is closed. The real local-alpha
live proof is still blocked on operator-controlled credentials and real-world
walkthrough/soak time.

---

## 4. Required Gates

### A0 - Claude Local Login Gate

Goal: local subscription Claude Code must work in headless mode.

Run:

```sh
claude -p 'Respond with exactly: CLAUDE_LOGIN_OK'
```

Pass criteria:

- command exits 0;
- output contains exactly `CLAUDE_LOGIN_OK`;
- no Anthropic API fallback is used;
- record the command result in an evidence report.

If it fails with 401 or asks for `/login`, the operator must open interactive
Claude Code and run `/login`. Keep this as HOLD until fixed.

### A1 - Strict Real Smoke

Goal: prove the live path reaches planner/coder/Gemini/Draft-PR gate.

Run after A0:

```sh
AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_P1=1 \
AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI=1 \
pnpm test:cockpit:real-smoke
```

Pass criteria:

- planner provider is `claude-cli` with local auth;
- coder provider is `codex-cli` with local auth;
- worker produces evidence;
- Gemini hard gate returns `pass`;
- Draft PR creation remains blocked by `REMOTE_WRITES_DISABLED`;
- no PR URL is created.

### A2 - Dual-Device Multi-User Walkthrough

Goal: prove the alpha cockpit works from the operator Mac and at least one
second device on Tailscale/LAN.

Minimum script:

1. Start the cockpit on the Mac with remote writes disabled.
2. Open the cockpit from the Mac browser.
3. Open the cockpit from a second device through the Tailscale/LAN address.
4. Submit two named users' requests.
5. Confirm each request is grouped/audited by submitter.
6. Confirm non-owner users can observe/answer clarification but cannot
   approve/start/create-pr.
7. Capture screenshots and a short written observation report under
   `evidence/browser-cockpit-quality/`.

Pass criteria:

- two distinct users are visible in grouping/audit surfaces;
- operator-only actions are unavailable or blocked for non-owner users;
- five-card default renders correctly on both devices;
- no remote write occurs.

### A3 - One-Week Soak

Goal: prove local-alpha stability over real time.

Window: 7 consecutive real days after A1 and A2 pass.

Track:

- uptime and restarts;
- request count by user;
- clarification answers;
- holds created/resolved;
- validator verdicts;
- blocked owner-only actions;
- memory/audit attribution;
- safety violations;
- resource pressure and quota/auth interruptions.

Pass criteria:

- at least 5 trusted users are onboarded or invited, with at least 2 active;
- zero unauthorized approve/start/create-pr actions;
- zero auto-merge or unapproved remote writes;
- all holds are either resolved or explicitly carried forward;
- final report lands under `evidence/soak/cloudhull-alpha-week-YYYY-MM-DD/`.

---

## 5. Claude Loop Prompt

Use this prompt for the next Claude Code loop:

```text
You are operating in /Users/lanston/projects/claude-code-247.

Read AGENTS.md, WORKBOOK_v4.md §0, and
docs/execution-workbooks/cloudhull-alpha-loop-workbook-2026-06-12.md before
any write.

Your mission is CloudHull local-alpha proof, not new feature expansion.

First, observe current git state and PR #54. Do not auto-merge. If PR #54 has
not been operator-merged, report its current checks and wait for explicit
operator direction before any GitHub write.

Then close the alpha gates in order:

1. Prove local Claude Code headless auth with:
   claude -p 'Respond with exactly: CLAUDE_LOGIN_OK'
   If it fails with 401 or asks for /login, create/maintain HOLD
   operator_claude_login_headless. Do not use Anthropic API fallback.

2. After A0 passes, run strict real-smoke:
   AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_P1=1
   AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI=1
   pnpm test:cockpit:real-smoke
   Preserve the evidence report path. A planner/coder HOLD is not a pass.

3. After A1 passes, guide and record a real dual-device walkthrough:
   Mac browser plus one second Tailscale/LAN device, two named users, grouped
   audit, five-card default, non-owner action blocking, screenshots and report.

4. After A2 passes, start the real one-week soak. Do not compress it and call it
   complete. Produce daily notes and a final evidence report.

At every step:

- keep remote writes disabled unless the operator explicitly approves a gated
  write and repository policy allows it;
- never edit secrets or forbidden paths;
- validators see evidence only;
- no silent API fallback;
- no self-approval;
- no auto-merge.

Output after each loop:

## CloudHull Alpha Loop
### Gate
### What changed
### Evidence
### Validation
### Holds
### Next operator action
```

---

## 6. Exit Definition

CloudHull local alpha is ready to invite 5-6 trusted users only when:

- PR #54 or its successor is merged by the operator, not self-merged;
- A0 local Claude headless login passes;
- A1 strict real-smoke passes with real planner/coder/Gemini evidence;
- A2 dual-device walkthrough passes with screenshots/report;
- A3 one-week soak completes with zero safety violations;
- final workbook/handoff names remaining risks honestly.
