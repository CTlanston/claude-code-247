# Stage A — L1 Acceptance Notes

**Session:** s_0001 · 2026-05-26
**Branch:** v2-foundation
**Outcome:** PASSED (4/4 acceptance criteria)

## Acceptance criteria (workbook §3 Stage A)

| # | Criterion | Status | Evidence |
|---|-----------|--------|----------|
| 1 | `pnpm test --filter @aedev/event-log` green (workbook says `@claude247/event-log` — see naming note below) | ✓ | `pnpm-test.txt` → 11/11 |
| 2 | Reducer two-way invariant `events → state → events` ≥ 5 cases | ✓ exceeded | 10 cases in `packages/event-log/src/reducer.test.ts` (cases 1–10) |
| 3 | `pnpm typecheck` green | ✓ | `typecheck.txt` — all 12 workspace projects clean |
| 4 | ADR-0010 + spike file exist and cross-reference each other | ✓ | `docs/adr/0010-three-plane-event-sourced.md` ↔ `docs/spikes/dispatch-approval.md`. Workbook §3 Stage A also references both |

## Stage A acceptance test command

```
pnpm vitest run packages/event-log packages/core/src/migrations.test.ts
```

Output captured in `pnpm-test.txt` — 17/17 (11 event-log + 6 migrations).

## Naming deviation

Workbook spec'd the package name `@claude247/event-log`. The existing
workspace uses `@aedev/*` (per `pnpm-workspace.yaml` and every other
package). Renaming the namespace mid-stage would violate Surgical Changes,
so I shipped `@aedev/event-log` and flag this as a workbook-amend follow-up
(eventual proposal under §7.4 if normalization is wanted).

## Full-suite stability note (not a Stage A blocker)

Running `pnpm test` (entire workspace) under heavy interactive load
intermittently timed out three subprocess-spawning tests at the default
5000 ms threshold:

- `packages/claude247-bridge/src/bridge-runner.test.ts` — happy path
- `packages/preview/src/preview-adapter.test.ts` — CloudflarePagesAdapter
  extracts URL
- `packages/runner/src/docker-runner.test.ts` — fake-docker success

Re-running those files in isolation: **18/18 + 1 skipped, all under 2 s**.
Verified twice this session — once at boot (green) and once after the flake
(green again in isolation). Root cause is vitest worker concurrency
saturating CPU during heavy parallel runs, not a regression introduced by
Stage A code. Stage A acceptance is narrowly scoped to event-log + migrations
+ typecheck per workbook §3 — those are clean.

Follow-up issue to file: bump `testTimeout` for subprocess-spawning suites
(or shrink fake binary sleep windows). Not in Stage A scope; flagged for
later.

## Cross-cutting checks (workbook §4)

- §4.1 — No `.only`, no `.skip` introduced. 6 pre-existing skips remain.
- §4.2 — Commits will use `[A.X]` prefix per Stage A subset (A.0–A.4 + A.exit).
- §4.3 — ADR-0010 is in `docs/adr/`, contiguous numbering, has Status /
  Context / Decision / Consequences / Date.
- §4.4 — Event shape (`id / task_id / ts / actor / kind / idempotency /
  payload / causation_id / correlation_id`) implemented in
  `packages/event-log/src/types.ts` with zod validation.
- §4.5 — Idempotency: every append computes a `sha256:` key (hashIdempotency)
  or accepts an explicit one. Duplicate keys are deduped (cases 5–6).
- §4.6 — No swallowed exceptions; appender throws on invalid event shape
  (zod parse).

## Self-check against §1 GROUND RULES

| Rule | Status |
|------|--------|
| 1. Never skip acceptance | ✓ Ran event-log + migrations + typecheck |
| 2. Single stage per commit | ✓ Will split into [A.0]–[A.4] + [A.exit] |
| 3. Architecture changes → ADR | ✓ ADR-0010 written for the event-sourced shift |
| 4. Schema dual-compat | ✓ v1 `events` table preserved; new `event_log` added (additive only) |
| 5. Side effects need idem keys | ✓ All git commits use tree-sha implicitly; no external side effects this session |
| 6. Event before view | ✓ Infrastructure shipped; no views written yet |
| 7. No irreversible ops | ✓ No git rm / rm -rf / DROP TABLE / git push --force |
| 8. CLI in workers only | ✓ No CLI spawn anywhere in new code |
| 9. Read §0 / update §0+§9 at exit | ✓ Boot read; exit updates queued |
| 10. Don't modify §1 | ✓ Unchanged |
