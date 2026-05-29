# Operator Cockpit — UX Hardening Validation Handoff (for Codex review)

Date: 2026-05-28
From: Claude Code (implementer)
To: Codex (independent validator / reviewer)
Predecessor: [operator-cockpit-product-ux-handoff-2026-05-28.md](operator-cockpit-product-ux-handoff-2026-05-28.md)

## 0. TL;DR

This is a follow-up pass that implements the **"Remaining UX Work" items 1–7** from the
predecessor handoff. Item 6 (bilingual copy) was already done; items 1, 3, 5, 7 were not
started and 2, 4 were partial — all are now implemented.

I am asking you (Codex) to **independently validate and review** the change set — do not trust
this document's claims. Re-run every command in §4 yourself, read the files in §2, and apply the
review lens in §5. Report what actually passes, what doesn't, and anything unsafe or fake.

**Nothing is committed.** Review the working tree directly (the files listed in §2), not a PR or
a commit range.

## 1. Context you need

- Repo: `claude-code-247` (pnpm monorepo, TypeScript-only). Package manager: `pnpm` (Node ≥ 20).
- The Operator Cockpit is a guided AI-coworker UI: `Idea → brainstorm → PRD/ADR/Roadmap →
  approve → execute → evidence gate → (blocked) draft PR`. Daemon on `:7247`, dashboard on `:7248`.
- The cockpit feature itself (`packages/daemon/src/routes/operator.ts`,
  `apps/dashboard/src/pages/Cockpit.tsx`, `scripts/operator-cockpit-e2e.ts`) is **new and
  untracked** in git — this pass edits those plus several tracked files.
- **Determinism:** the e2e and screenshot scripts force `AEDEV_COCKPIT_FORCE_MOCK=1`,
  `AEDEV_COCKPIT_FORCE_TEMPLATE=1`, and disable the real Claude/Codex/Gemini/OpenAI backends.
  So they validate the **flow, contracts, and safety gates** — **not** the real planner/worker
  output. That is intentional (CI must be offline + deterministic), but it means "green" here
  does **not** prove the live AI path works. Flag if you think that gap matters.

## 2. Change set — file by file (your review surface)

| File | Status | What changed | Review focus |
|------|--------|--------------|--------------|
| `packages/core/src/schema.ts` | modified | Added `OperatorChoiceAction`, `OperatorChoice`, and `choices?: OperatorChoice[]` on `OperatorMessage` | Type shape sane? |
| `packages/core/src/migrations.ts` | modified | Added migration **v5** `operator-message-choices`: `ALTER TABLE operator_messages ADD COLUMN choices TEXT` | Additive & safe on already-migrated DBs? Does it break the v1↔v5 round-trip / rollback-drill tests? |
| `packages/core/src/db.ts` | modified | `insertOperatorMessage` serializes `choices` (JSON or `null`); `listOperatorMessages` parses it | Null-safe round-trip? |
| `packages/daemon/src/routes/operator.ts` | new (untracked) | `brainstormChoices()` helper; attaches structured choices to the brainstorm assistant message (non-hold only); emits milestone events (see §3.2) | Choices only on success path? Events fire at the right moments? No fake cost? |
| `packages/daemon/src/server.test.ts` | modified | New assertions: brainstorm message carries the 3 choices with actions `['generate-roadmap','ask-questions','add-constraints']`; overview events contain the milestones; gated-PR test asserts `validator_started`/`validator_done` | Are these assertions **meaningful** or tautological? |
| `apps/dashboard/src/api.ts` | modified | Added `ApiOperatorChoice`, `choices?` on `ApiOperatorMessage`, `ApiEvent`, and required `events` on `ApiMissionOverview` | Types match the daemon JSON? |
| `apps/dashboard/src/pages/Cockpit.tsx` | new (untracked) | Data-driven `ChoiceBar`; `handleChoice`; `resetMission` + **New Mission** button; friendly stale-session notice; `friendlyEvent`/`eventDetail` + `EVENT_LABELS`; `AgentActivity` friendly rows from `overview.events`; raw `EventLog` moved into a collapsed `<details>`; inline **Start** button gets `primary pulse` when approved | Any dead props? Choices gated correctly (hidden after roadmap)? Raw JSON truly secondary now? |
| `apps/dashboard/index.html` | modified | CSS for `.choice-row`, `.activity-row`, `details.raw-events`, and `button.action.pulse` + `@keyframes cockpit-pulse` | Cosmetic only |
| `scripts/operator-cockpit-e2e.ts` | new (untracked) | One-line fix: `.first()` on the `REMOTE_WRITES_DISABLED` locator (see §6) | Is `.first()` masking a real bug? (I claim no — §6) |
| `scripts/operator-cockpit-screens.ts` | **new (created this pass)** | Deterministic Playwright screenshot script: 9 shots across desktop + mobile + long-Chinese + running + blocked states; asserts each PNG > 1 KB | Does it actually exercise the states it names? |
| `package.json` | modified | Added `test:cockpit:screens` script | — |
| `evidence/launch/cockpit-screens/*.png` | generated | 9 screenshots (untracked) | Eyeball the UX |

## 3. Design decisions (and the alternative I rejected)

### 3.1 Structured choices live on the message model (migration + column)
I added `choices` as a real column on `operator_messages` and attach them to the brainstorm
assistant message, rather than computing them ad-hoc in the API layer. Reasoning: the predecessor
handoff said "operator session **model**/API", and persisting makes it testable and survives reload.
**Alternative rejected:** deriving choices purely from session state in the response (lighter, but
not "in the model" and harder to assert).

### 3.2 Milestone events are additive, not renames
New events: `operator.roadmap_generation_started`, `operator.roadmap_generation_done`,
`operator.approval_recorded`, `operator.worker_assigned`, `operator.validator_started`,
`operator.validator_done`, `operator.evidence_written`. Existing events (`worker_started`,
`worker_log`, `validator_result`, `artifact_written`, `stage_changed`, …) are **kept**. Renaming
would have risked breaking SSE consumers and existing tests. The UI maps both old and new.

### 3.3 Friendly feed is driven by polled `overview.events`, not SSE
`packages/daemon/src/routes/sse.ts` only sends the last-100 events **once at connect**; afterward it
pushes a periodic `state` payload (missions/tasks/approvals) but **not new events**. So the live raw
SSE stream is effectively a connect-time snapshot. I therefore drove the **friendly activity rows**
from `overview.events` (polled every 2 s in the Cockpit) and left the raw SSE stream as the
collapsed secondary `<details>`. **Please sanity-check this claim about sse.ts** — if I'm wrong and
SSE does push new events, the polling is redundant.

### 3.4 Structured `questions[]` parsing was deliberately NOT built
The handoff said "questions/choices". I implemented structured **action choices** only. Parsing the
planner's free-form markdown "Operator Questions" section into structured `questions[]` is fragile;
instead the `ask-questions` choice sends a prompt that makes the planner produce questions as text.
Flag if you think structured questions are required for acceptance.

## 4. How to validate (run these yourself)

> ⚠️ **Exit-code gotcha:** do **not** wrap these in `... | tail && echo $?` — the pipe reports
> `tail`'s exit code, not pnpm's, and will hide failures. Run each command directly and check `$?`.

```bash
pnpm install                       # if not already installed

# 1. Types (all packages, then the dashboard explicitly — vite build does NOT type-check)
pnpm typecheck
pnpm --dir apps/dashboard typecheck

# 2. Unit/integration tests (core migrations + daemon contract + dashboard api)
pnpm vitest run \
  packages/core/src/migrations.test.ts \
  packages/core/src/migrate.test.ts \
  packages/core/src/rollback-drill.test.ts \
  packages/daemon/src/server.test.ts \
  apps/dashboard/src/api.test.ts

# 3. Dashboard build
pnpm --dir apps/dashboard build

# 4. Deterministic functional e2e (boots daemon + vite + headless chromium)
pnpm test:cockpit:e2e

# 5. Screenshot QA (writes 9 PNGs to evidence/launch/cockpit-screens/)
pnpm test:cockpit:screens
```

**Expected results (what I observed):**

- `pnpm typecheck` → exit 0; `apps/dashboard typecheck` → exit 0
- vitest → **34 passed** (5 files), incl. `runs the operator cockpit session flow…` and
  `creates a gated draft PR only when…`
- dashboard build → exit 0
- `test:cockpit:e2e` → prints `Operator Cockpit deterministic e2e PASS`
- `test:cockpit:screens` → prints `Operator Cockpit screenshots PASS — 9 images in …`

Playwright chromium must be installed (`npx playwright install chromium` if missing).

## 5. What to review for (red flags — be adversarial)

1. **Safety gates unchanged** (non-negotiable per `CLAUDE.md`):
   - No auto-merge anywhere.
   - Draft PR stays blocked unless `allow_remote_writes=true` (`DraftPrGate` →
     `REMOTE_WRITES_DISABLED`). The e2e asserts **no** `githubPrUrl` is created.
   - Validators read evidence only; missing validators report `not_configured`, never "pass".
   - No faked token/cost: `summarizeCost` returns `null` unless real provider usage exists.
   Confirm none of my changes weakened these.
2. **Fake / tautological tests.** Read the new assertions in `server.test.ts`. Do they assert real
   content (choice actions, milestone event presence) or just that something is truthy?
3. **Scope drift.** Changes should be confined to the cockpit choices/events/UI + the screenshot
   script. Flag anything unrelated.
4. **Migration safety.** v5 is `ALTER TABLE … ADD COLUMN`. Verify it applies cleanly on an
   already-migrated DB and that `migrations.test.ts` / `migrate.test.ts` / `rollback-drill.test.ts`
   (which use dynamic `MIGRATIONS.length` / `Math.max(version)`) still pass.
5. **UI honesty.** The friendly activity feed and "approved" pulse must reflect real state, not
   hard-coded optimism. The choices must disappear once a roadmap exists.

## 6. Regression I found and fixed (full disclosure)

After adding the friendly activity row for `operator.draft_pr_blocked`, the block reason
`REMOTE_WRITES_DISABLED` now renders in **two** places (the Draft PR status line **and** the
activity row). The existing e2e used `getByText('REMOTE_WRITES_DISABLED')`, which then matched 2
elements and failed Playwright strict mode. I fixed both `operator-cockpit-e2e.ts` and
`operator-cockpit-screens.ts` with `.first()`. **Verify this is a legitimate two-location render and
not a locator hiding a real failure** — the block must still actually occur (status `blocked`, code
`REMOTE_WRITES_DISABLED`, no PR URL).

## 7. Known limitations / deferred by design

- **SSE is snapshot-only** (see §3.3). Making the daemon push new events live over SSE is a separate
  follow-up; the friendly feed works around it by polling `overview`.
- **No structured `questions[]`** (see §3.4) — only action `choices[]`.
- **Screenshots write into `evidence/launch/cockpit-screens/`** (untracked). Override with
  `AEDEV_COCKPIT_SCREENS_DIR`. Gitignore if undesired.
- Live AI planner/worker path is not covered by automated tests (deterministic mocks only).

## 8. Acceptance checklist (map back to the predecessor handoff)

| # | Remaining UX item | Status I claim | Where to verify |
|---|-------------------|----------------|-----------------|
| 1 | Structured brainstorm questions/choices in model/API | Done (choices) | schema/migrations/db, `brainstormChoices()`, `ChoiceBar`, server.test |
| 2 | Action-level progress events | Done | §3.2 events in `operator.ts`, server.test milestones |
| 3 | Friendly bilingual rows; raw stream secondary | Done | `friendlyEvent`/`EVENT_LABELS`, `AgentActivity`, collapsed `EventLog` |
| 4 | Obvious approved state + primary Start CTA | Done | coach card + inline Start `primary pulse`, `04-desktop-approved.png` |
| 5 | Session recovery + New Mission reset | Done | `resetMission`, New Mission button, stale-session notice |
| 6 | Bilingual copy pass | Pre-existing | throughout |
| 7 | Playwright screenshots (desktop/mobile/long-Chinese/running/blocked) | Done | `operator-cockpit-screens.ts`, 9 PNGs |

Safety acceptance (must remain true): bilingual + Chinese-first ✓, no faked cost ✓, no PR/merge
unless gates explicitly enabled ✓, validators evidence-only ✓.

## 9. Suggested Codex prompt (paste this into `codex`)

```text
You are an independent reviewer. Do NOT trust the handoff's claims; verify everything.

Read docs/handoff/operator-cockpit-ux-hardening-validation-handoff-2026-05-28.md, then:

1. Run every command in §4 EXACTLY (no pipe-to-tail — it masks exit codes). Record real
   pass/fail and the vitest count.
2. Read the files in §2. For each, judge correctness and whether the new server.test
   assertions are meaningful (not tautological).
3. Apply the §5 review lens hard:
   - Confirm no safety gate weakened: no auto-merge; draft PR blocked w/ REMOTE_WRITES_DISABLED
     and no githubPrUrl; validators evidence-only + not_configured≠pass; no faked cost.
   - Confirm migration v5 is additive and the three migration test files still pass.
   - Confirm the .first() fix in §6 is a real two-location render, not a hidden failure.
4. Independently confirm the §3.3 claim about sse.ts (snapshot-only) by reading
   packages/daemon/src/routes/sse.ts.
5. Open evidence/launch/cockpit-screens/*.png and confirm the UI states match their filenames.

Output: a PASS/FAIL verdict per item in §8, a list of any real defects or unsafe changes,
and any test you believe is fake or weak. Be specific with file:line. Do not modify code.
```
