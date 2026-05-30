# Approval-v2 Tamper Hold Resolved — 2026-05-29

Session: `s_0014`
Slice: `HOLD-BASELINE-APPROVAL-V2-TAMPER`

## Scope

This run resolved the baseline failure found during `s_0013`:
`packages/approval-v2/src/approval-v2.test.ts` case 2 intermittently accepted a
tampered signature token as `ok=true`.

P2 live disposable-repo smoke was not run in this slice because the
remote-write gate/auth hold remains open.

## Root Cause

Approval-v2 compared decoded HMAC bytes. For a 32-byte HMAC-SHA256 signature,
the final base64url character has unused padding bits. A non-canonical final
character can decode to the same bytes as the canonical signature, so a
different token string could still pass byte-level comparison.

## Fix

- `TokenVerifier` now rejects non-canonical base64url signature encodings before
  timing-safe comparison.
- Signature comparison now uses the canonical base64url HMAC text.
- The existing tamper test flips a high-order signature character so it is
  deterministic.
- A regression test covers non-canonical signature aliases explicitly.

## Validation

- `pnpm vitest run packages/approval-v2/src/approval-v2.test.ts` — PASS, 10
  tests passed.
- `bash scripts/doctor.sh` — PASS required checks; daemon install/responding
  warnings only.
- `pnpm lint` — PASS.
- `pnpm typecheck` — PASS.
- `pnpm test` — PASS, 93 files passed; 554 tests passed, 6 skipped.
- `rg "child_process" packages/daemon/src` — PASS, no matches.

## Remaining Hold

`HOLD-P2-LIVE-SMOKE-GATE-AUTH` remains open. Operator repair is still required:

1. Restore `~/.Codex-247/config.yaml` with `system.allow_remote_writes=true`.
2. Restore `~/.Codex-247/repos.yaml` with the disposable smoke repo
   `enabled: true`.
3. Refresh `gh` auth for `github.com`.

After that, run:

```sh
pnpm test:cockpit:p3-remote-smoke
```
