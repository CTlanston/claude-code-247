# Stage A · L2 Reviewer Report — 2026-05-26

## Verdict
PASS-with-notes

Stage A's L1 acceptance suite is fully green, typecheck is clean across the
workspace, the reducer round-trip case count is well above the spec floor,
ADR-0010 and the dispatch spike cross-reference each other, and the reviewer
injection (delete-and-restore-shards) confirms the NDJSON log truly is the
source of truth. Three non-blocking smells are flagged for Stage B intake.

## Acceptance

- **`pnpm vitest run packages/event-log packages/core/src/migrations.test.ts`**
  PASS. 2 files / **17 tests** / 0 skipped / 0 failed. Output:

  ```
  ✓ packages/core/src/migrations.test.ts (6 tests) 15ms
  ✓ packages/event-log/src/reducer.test.ts (11 tests) 14ms
   Test Files  2 passed (2)
        Tests  17 passed (17)
  ```

- **`pnpm typecheck`** PASS. All 12 workspace packages compile with
  `tsc --noEmit`, 0 errors. (event-log, core, secrets, dashboard, cli,
  github, claude247-bridge, preview, qa, validators, runner, daemon.)

- **Reducer round-trip cases** — spec needs ≥5; file has **10 numbered
  round-trip cases + 1 helper test** (11 total). The 10 cases:
  1. empty log → initial state
  2. single event → incremented state
  3. associativity: `reduce(reduce(E1), E2) === reduce(E1++E2)`
  4. deletion+replay equivalence (the GROUND RULE 6 invariant in test form)
  5. same idempotency key dedupes (at most once)
  6. idempotency survives process restart (second `FileEventLog` over same dir)
  7. monthly rotation: events across `events-2026-04.ndjson` and
     `events-2026-05.ndjson` reduce in chronological order
  8. `fromTs` cursor resume
  9. cross-task isolation (task A reducer ignores task B events)
  10. causation chain reachable to root via `causation_id`

  Spec floor satisfied with margin.

- **ADR-0010 ↔ spike cross-reference** — CONFIRMED.
  - `docs/adr/0010-three-plane-event-sourced.md` line 7:
    `**Spike:** [docs/spikes/dispatch-approval.md](../spikes/dispatch-approval.md)`
  - `docs/spikes/dispatch-approval.md` line 6:
    `**Decided by:** ADR-0010 (this spike is the experimental record behind it).`
  Both files exist; mutual reference is explicit.

## Reviewer injection result

Script: `scripts/l2-stage-a-inject.ts` (added by this reviewer; uses only the
public `@aedev/event-log` API: `FileEventLog`, `toArray`, `Reducer`).

Procedure (all eight steps in §workbook L2):
1. `FileEventLog` constructed over a fresh `mkdtemp` dir.
2. Appended 10 causally-chained events for `task_l2_review`, each carrying
   `causation_id = id(prev)` (the first event's `causation_id = null`).
3. Reduced to a `(total, byKind, ids)` snapshot **S1**: total=10, 10 distinct kinds.
4. Listed shard files: `["events-2026-05.ndjson"]`. Copied each to a
   separate backup tmp dir, then `fs.unlink`-ed the originals.
5. **Re-constructed** `FileEventLog` over the now-empty dir and re-reduced:
   `total = 0`. ✅ Proves there is no hidden in-process or in-DB cache —
   the on-disk NDJSON is the only source of truth.
6. Restored shard files from the backup copies.
7. Re-constructed `FileEventLog` and re-reduced to **S2**.
   `JSON.stringify(S1) === JSON.stringify(S2)` → **byte-equal: yes**.
8. Sampled three event IDs (positions 0, 5, 9 in the chain) and walked
   `causation_id` to the root.

Script output (excerpt):

```
[l2] appended 10 events
[l2] S1.total = 10, kinds = 10
[l2] shard files on disk: ["events-2026-05.ndjson"]
[l2] sEmpty.total = 0 (expect 0)
[l2] S1 byte-equal S2 ? true
[l2] PASS — log is source-of-truth, restoration byte-equal, all 3 chains root at null.
```

**Byte-equal: yes.**

## Event causation traces (3 samples)

All three samples terminate at a single root whose `causation_id` is `null`,
matching the workbook §4.4 invariant *"任意 event 可追溯到根因"*.

| sample (position) | event id                              | chain depth | root id                              | root.causation_id |
| ----------------- | ------------------------------------- | ----------- | ------------------------------------ | ----------------- |
| 0 (the root itself) | `evt_01KSHV4TGJAWGB1TZDGR9AS6RE`    | 1           | `evt_01KSHV4TGJAWGB1TZDGR9AS6RE`     | null              |
| 5                   | `evt_01KSHV4TGK5X45CN3HJA171099`    | 6           | `evt_01KSHV4TGJAWGB1TZDGR9AS6RE`     | null              |
| 9 (deepest)         | `evt_01KSHV4TGMQ1TP50DHYKD1MDHP`    | 10          | `evt_01KSHV4TGJAWGB1TZDGR9AS6RE`     | null              |

Chain integrity: sample-9's walk yields exactly 10 hops with no cycle, no
broken parent (the safety counter never triggered), and every intermediate
event was findable by id in the reduced set.

## Smells / risks

1. **Appender idempotency is single-process-only by design, and that fact is
   documented in code but worth re-flagging.** `NdjsonAppender` keeps an
   in-memory `Set<string>` (`this.seen`) and hydrates it from disk on
   construction. The hydrate **does** walk every monthly shard, so a process
   restart cannot accept a duplicate idempotency key — that case is covered
   by `reducer.test.ts` case 6. However, **two concurrent processes writing
   the same dir can race**: process A appends, process B has already
   constructed its `Set` and missed A's write, so B may append the same
   idempotency key. The header comment on the class names this ("Single-
   process safe; multi-process callers should front this with a per-task
   lock (Stage B+)"). This is acceptable for Stage A's scope but **must**
   be solved before any code path can write the log from more than one
   process — i.e., before Stage B's SessionProbe (worker processes) starts
   emitting `cli.session.probed` directly. Today the workers don't write
   yet, so there is no live exposure.

2. **`AppenderOpts.idemScanLimit` is dead.** Declared in the interface, never
   read in `hydrateSeen` (which reads every shard in full). Either wire it
   up or delete the field before Stage B fans out additional callers.
   Surgical Changes says don't fix it inline; flagging for the Stage B
   intake.

3. **The "cross-month duplicate detection is the reducer's job" comment is
   misleading.** The current `hydrateSeen` actually loads every shard, so
   cross-month duplicates *are* caught by the appender in-process. The
   comment should either be removed or reworded to "cross-process duplicate
   detection is the reducer's job, since the appender's in-memory set is
   per-process". Not a correctness bug, but a future maintainer could read
   the comment, "optimize" hydrate to load only the current month, and
   silently regress test case 6.

4. **Migration v3 honors GROUND RULE 4 — confirmed clean.** v3 only
   *adds* `event_log` table + 3 indexes via `CREATE TABLE IF NOT EXISTS` /
   `CREATE INDEX IF NOT EXISTS`. No `DROP`, no `ALTER … DROP`, no
   `ALTER … RENAME`, no type change. The legacy `events` table is preserved
   bit-for-bit (asserted by `migrations.test.ts` case "preserves the legacy
   events table"). The v2 migration is also clean: pure `ADD COLUMN`.

5. **GROUND RULE 8 (no `claude` CLI in the daemon process) — clean.**
   `grep -rE 'spawn|exec.*claude|execa.*claude'` over
   `packages/daemon/src/` returns nothing. The 8 skeleton dirs
   (`session`, `hold`, `approval-v2`, `push`, `moves`, `chaos`, `obs`,
   `supervisor`) each contain a single `index.ts` that exports a
   `<NAME>_STAGE = 'A.3-skeleton'` constant and nothing else. No v1
   behavior has leaked in.

6. **Event schema matches workbook §4.4.** `types.ts` declares
   `{id, task_id, ts, actor, kind, idempotency, payload, causation_id,
   correlation_id}` — exact set, exact names. `id` is regex-locked to
   `^evt_[0-9A-Z]{26}$` (ULID). `idempotency` is regex-locked to
   `sha256:<64-hex>`. `kind` requires three dot-separated segments
   (`<area>.<thing>.<verb>`). `causation_id` is nullable; `correlation_id`
   is required (defaults to `task_id` if omitted at append-time). Schema
   is enforced via `EventSchema.parse` on every append.

7. **ADR-0010 is concrete, not hand-wavy.** It commits to: three named
   planes with named responsibilities; event_log + monthly NDJSON shards
   as source of truth; the exact 9-field event shape; capability-token
   gating of all external writes; dual-rail approval from day 0; HOLD as
   a first-class event-log entry with `{ttl, on_timeout}` policy; CLI
   confined to a robustness layer in M1. It also names the deferred
   scope (multi-daemon clustering, external SSE subscribers) and the
   measurable falsification criteria (`daemon_recovery_p95_sec < 90`,
   `redteam_pass_rate = 1.00`, `cli_session_pool_min ≥ 1`). This is a
   decision document, not a wishlist.

8. **Workbook deviation — package namespace.** The workbook prescribes
   `@claude247/event-log`; the shipped package is `@aedev/event-log`. The
   s_0001 session notes call this out as a deliberate choice to stay
   consistent with the rest of the existing workspace (`@aedev/*`). This
   reviewer does not consider it a defect — internal naming, no downstream
   contract — but flags it so future merges with the workbook stay
   consistent. Either rename the package or amend the workbook line; do
   not let the inconsistency persist past v2.1.

9. **Workbook deviation — `approval-v2/` instead of `approval/`.** The
   workbook lists `packages/daemon/src/approval/index.ts`; the shipped
   directory is `approval-v2/`. The s_0001 notes explain this avoids a
   TS module-resolution collision with the pre-existing flat file
   `approval.ts` in the same parent dir. Reasonable. Plan to clean up in
   Stage D when legacy approval is retired (the spike doc already
   anticipates this — `approval-v2/src/{gateway,…}.ts` is named in §"Where
   this lands in code").

10. **Stage A is correctly scoped.** The s_0001 notes admit the full
    `pnpm test` has a pre-existing subprocess-timeout flake unrelated to
    Stage A; the scoped acceptance command in the workbook
    (`pnpm vitest run packages/event-log packages/core/src/migrations.test.ts`)
    is what was run for L1, and is what this reviewer re-ran for L2.
    That flake is **not** a Stage A regression and is acceptable to defer,
    but Stage B should not be allowed to exit while the flake remains —
    L2's "test all green" reading of GROUND RULE 1 will get harder to
    audit as the daemon picks up live behavior.

## Recommendations for Stage B

- **Lock the appender for multi-process use.** Stage B will introduce
  worker-side `cli.session.probed` emission. Before the first worker writes
  the log, add either (a) a per-task advisory `flock` around the NDJSON
  shard file, or (b) a single-writer rule where workers RPC the daemon and
  only the daemon's appender touches disk. Reviewer's preference is (b) —
  it preserves the "events first, views second" GROUND RULE 6 chain with a
  single point of sequencing and avoids the cross-platform `flock`
  portability issue Stage H will already have to handle for supervisor.
- **Wire or drop `idemScanLimit`.** Don't let dead config fields accrete.
- **Fix the misleading hydrate comment** while the appender is still
  small enough to read in one screen.
- **Rename `@aedev/event-log` → `@claude247/event-log`** *or* amend the
  workbook line — do this as a single trivial commit early in Stage B so
  the inconsistency does not propagate into B's new packages
  (`cli-robust`, etc.).
- **Tackle the full-suite test flake** as a B.0 hygiene commit before
  scaffolding SessionProbe; otherwise it will be impossible to tell a B
  regression from the pre-existing flake during L1.
- **Carry forward `scripts/l2-stage-a-inject.ts`** as the template for
  Stage B+'s L2 injection scripts. The delete-shards / restore-shards /
  byte-equal pattern generalizes well to every subsequent reducer-derived
  view.

---

**Reviewer:** independent L2 session (did not read `evidence/stage-A/`).
**Source consulted:** `EXECUTION_WORKBOOK.md` §1, §3 Stage A, §4, §5;
`packages/event-log/src/{types,appender,reader,reducer,log,index}.ts`;
`packages/event-log/src/reducer.test.ts`; `packages/core/src/migrations.ts`;
`packages/core/src/migrations.test.ts`; `docs/adr/0010-three-plane-event-sourced.md`;
`docs/spikes/dispatch-approval.md`; all 8 daemon skeleton `index.ts` files.
