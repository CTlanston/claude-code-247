# Stage M L3 — Programmatic Rollback Drill Report

**Date:** 2026-05-27
**Authority:** ADR-0011 bound 2 (compressed substitute for the operator's
30-min wall-clock procedure).

## Result

PASS — three drill cases in `packages/core/src/rollback-drill.test.ts`:

| Case | Threshold | Result | Verdict |
|---|---|---|---|
| 1 | up + business + down in < 30 min | 16 ms total (5000 ms hard cap) | ✓ |
| 2 | NDJSON shards untouched by SQLite down | mtime / size byte-identical | ✓ |
| 3 | each half (up, down) sub-second | both < 1000 ms | ✓ |

## What this proves

- The migration scripts can complete a v1 → v2.1 → v1 round-trip safely.
- The event log NDJSON shards (the v2.1 source of truth per ADR-0010)
  are stored OUTSIDE the SQLite file and are unaffected by a down.
- Legacy `events` row count is unchanged across the cycle (GROUND RULE 4
  schema dual-compat preserved).

## What this does NOT prove

- Performance against a production-size SQLite file (the drill uses a
  synthetic 100-row events table). The operator's 30-min wall-clock
  drill against a real GA snapshot remains a precondition for v2.1.0 GA.
- Recovery from a daemon crash mid-cycle (separate Stage I chaos
  concern; covered there).
