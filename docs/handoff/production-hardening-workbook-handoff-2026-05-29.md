# Production-Hardening Workbook Handoff

Date: 2026-05-29
Companion assessment: [production-readiness-assessment-2026-05-29.md](production-readiness-assessment-2026-05-29.md)
Read before any write: [EXECUTION_WORKBOOK.md §0](../../EXECUTION_WORKBOOK.md)

> This handoff turns the assessment's plan (P0–P6) into a concrete next-session
> slice. It follows the workbook convention: **honest state → next stage →
> acceptance gate → evidence → verification → suggested prompt.** Do not tag GA.

---

## §0 — Honest current state (no overclaim)

- **Highest real grade:** RC for a *supervised single-operator* tool (per `ADR-0013`). **Not** unattended-24/7 production.
- **PRs:** #14 (cockpit cleanup) and #15 (V2.4 vertical slice) are **MERGED** to `main`.
- **Branch:** `codex/v24-vertical-slice`, working tree dirty (cockpit + pre-existing runtime edits intermixed — see assessment §4).
- **Proven this session:** cockpit live non-mock smoke PASSED (real planner JSON, real worker ran via `codex-cli`/`claude-cli`, validators `not_configured`, draft PR **blocked** `REMOTE_WRITES_DISABLED`, no PR URL). Mission ended at the WAITING gate (expected).
- **NOT proven / faked / missing (the gap to real production):**
  1. No `install_launchd.sh` / `uninstall_launchd.sh` — only `.tpl` templates; `docs/INSTALL.md`+`OPERATIONS.md` describe the wrong (Python, :8423) runtime.
  2. Real Docker worker logic still bridges to Python `runner/worker.py`; real-container test is opt-in only.
  3. `GitRemoteWriter.pushBranch` has no production impl — autonomous PR creation has never run live (parity Gate 8 ⏳).
  4. `packages/secrets` is 17 lines of types — ADR-0007 grant lifecycle unenforced.
  5. No real-clock soak — all soaks are compressed/in-memory.

## §1 — Next stage: P0 + P1 (housekeeping → install & boot)

This is the smallest slice that converts "can't even be installed" into "boots and survives a reboot." Everything else (real worker, real PR, soak) depends on a daemon you can actually start.

### Stage tasks

**P0 — Housekeeping**
1. Commit the dirty tree in scoped groups: (a) cockpit feature set, (b) the pre-existing runtime edits (runner/validator/mission-runner/SSE/vite) — see assessment §1 for the file split. Do **not** bundle them in one commit.
2. Fix `docs/INSTALL.md` and `docs/OPERATIONS.md` to describe the **TS daemon on :7247** (commands: `pnpm`, the real CLI). Archive or delete the Python/`make install`/:8423 instructions.

**P1 — Install & boot**
3. Author `scripts/install_launchd.sh` + `scripts/uninstall_launchd.sh` from the three `scripts/launchd/*.plist.tpl` templates (daemon, roadmap-agent, rollback-drill). Resolve `{{...}}` template vars (node path, repo path, log paths under `~/.claude-code-247/logs/`).
4. Ensure `scripts/doctor.sh` checks: node/pnpm versions, daemon port :7247 reachable, `~/.claude-code-247/` state dir, launchd job loaded.
5. Wire/confirm `aedev daemon status` (running/stopped + PID).

### Acceptance gate (must all pass)
- [ ] `git status` is clean or changes are in intentional, scoped commits.
- [ ] INSTALL.md/OPERATIONS.md match the running daemon (no :8423, no Python `make install`).
- [ ] Fresh shell: `bash scripts/install_launchd.sh` → daemon answers on `http://localhost:7247/health` (green).
- [ ] Daemon **survives logout/reboot** (launchd `KeepAlive`/`RunAtLoad` verified).
- [ ] `bash scripts/doctor.sh` exits 0 with all-green checks.
- [ ] `bash scripts/uninstall_launchd.sh` unloads the job and leaves no orphan process.
- [ ] Evidence written to `evidence/launch/install-boot-2026-05-XX.md` (commands run + outputs + reboot note).

### Verification commands
```bash
pnpm install
pnpm typecheck
pnpm test
bash scripts/doctor.sh
bash scripts/install_launchd.sh   # then: curl -s localhost:7247/health
launchctl list | grep claude247   # job loaded
bash scripts/uninstall_launchd.sh
```

## §2 — Safety invariants to preserve (do not regress)

1. `system.allow_remote_writes` defaults **false**; no push/PR/merge unless true **and** repo `enabled`.
2. Forbidden paths enforced (`.env*`, `secrets/**`, `.github/**`, `CLAUDE.md`, `AGENTS.md`).
3. Validators run on **evidence only**; missing validators ⇒ `not_configured`, never pass.
4. No auto-merge without two real validator PASSes; no self-approval.
5. No silent API fallback; subscription usage reported as run-count, never "$0".
6. **No GA tag** until assessment P1–P5 evidence exists (reopen ADR-0013 first).

## §3 — After this slice (sequencing)

P2 (real worker, retire bridge on happy path) → P3 (real draft-PR adapter behind the gate; closes Gate 8) → P5 (real ≥24 h soak under launchd). P4 (secrets engine) and P6 (GA gate) trail. Full detail + acceptance per stage in the assessment §5.

## §4 — Suggested next prompt

```text
Read docs/handoff/production-hardening-workbook-handoff-2026-05-29.md and the companion
assessment. Execute Stage P0 + P1 only (housekeeping → install & boot). Do NOT start the
real-worker or remote-write work yet, and do NOT create any GA tag.

1. Commit the dirty tree in scoped groups (cockpit set vs pre-existing runtime edits).
2. Rewrite docs/INSTALL.md + docs/OPERATIONS.md for the TS daemon on :7247 (drop the
   Python/:8423 instructions).
3. Write scripts/install_launchd.sh + uninstall_launchd.sh from scripts/launchd/*.tpl,
   plus confirm scripts/doctor.sh and `aedev daemon status`.
4. Prove the acceptance gate: install → /health green → survives reboot → doctor green →
   clean uninstall. Save evidence to evidence/launch/install-boot-<date>.md.

Keep every §2 safety invariant. Run pnpm typecheck + pnpm test before finishing.
```
