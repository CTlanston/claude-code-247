# Restore Execution Contract

## Observable Behavior

- The running daemon responds successfully to the L0 smoke endpoints used by `scripts/launch-smoke.ts`.
- A real smoke run creates fresh `smoke-<UTC>.json` and `smoke-<UTC>.md` files under `evidence/launch`.
- The smoke report records `mode: real` and verdict `LAUNCH_AUTHORIZED`.
- Operator approval and HOLD resolution checks wait for observable daemon-side events and record non-trivial elapsed time.
- The roadmap proposal queue remains drained after the run.

## Non-Goals

- No synthetic smoke mode is used to close the real-smoke flag.
- No unrelated feature work, refactors, or control-plane edits are part of this change.
