# claude-code-247 — Production-Readiness Assessment & Plan

Date: 2026-05-29
Author: Claude Code (grounded audit)
Scope: whole system, not just the Operator Cockpit
Method: read the canonical docs + ADRs and verified the load-bearing claims directly against the tree (file existence, LOC, grep, git/PR state). Sources cited inline.

---

## 0. Verdict (the short answer)

**No — it is not yet a production-grade product you can drop in for unattended 24/7 autonomous use.**

It is a **well-architected, RC-grade control-plane prototype** with genuinely strong *safety* discipline, but the **core autonomous value loop is still faked or bridged**: it has never autonomously executed a real coding worker in Docker or opened a real GitHub PR on its own, there is **no working install/boot path**, and there has **never been a real-clock soak**.

Crucially, **the project's own docs agree** — this is not me contradicting the repo:
- `docs/roadmap.md:3` → **"Status: Phase 0 in progress"** (of 10 phases).
- `docs/aedev-prototype-status.md` → the TS runtime is in a **"parity window"**; the real Docker dispatch + GitHub PR execution still **delegate to a Python `claude247` kernel via a bridge**; Gate 8 (real GitHub PR end-to-end) is **"⏳ token-dependent / unverified."**
- `docs/adr/0013-rc-grade-is-prod-grade.md` → explicitly **"v2.2.0 should never have been tagged" GA** and redefines the bar to "rc-grade IS production grade *for single-operator infra*."

So the honest framing depends on which bar you mean:

| Readiness bar | Status |
|---|---|
| **A. Single-operator, supervised, experimental tool** (you watch it, mock/bridge assist allowed, no remote writes) | **≈ RC — usable today with caveats** |
| **B. Unattended 24/7 autonomous product, direct use** (boots on its own, runs real workers, opens real PRs, recovers itself) | **Not ready — core loop faked, no install, no soak** |

---

## 1. Completion matrix (calibrated, with evidence)

Percentages are "% of the way to Bar B (true production)". "Verified" = I checked the file/test myself this session.

| Area | % | Status | Evidence (verified) |
|---|---|---|---|
| Architecture & ADRs | 90% | Strong | three-plane event-sourced design; 17 ADRs in `docs/adr/` |
| Safety invariants | 85% | **Strength** | no-auto-merge, no-self-approval, dual-validator, forbidden-paths, secret-pattern guard — enforced by tests (`prototype-status.md` §Invariants; cockpit smoke held `REMOTE_WRITES_DISABLED`) |
| Control plane (daemon/state/intake/approvals/events/memory) | 80% | Implemented + unit-tested | 24 packages, 91 test files; `pnpm test`/`typecheck` green |
| Validators (Gemini/OpenAI real REST, evidence-only) | 75% | Real adapters | Parity Gate 7 ✅; ran in V2.4 S0 dual validation |
| Operator Cockpit | 70% | UI + contract solid; 1 live smoke | this session: e2e + 11 screenshots + 1 live non-mock smoke (planner JSON + worker ran, gates held). No soak; remote-write not live. |
| Docker worker execution | 40% | **Bridged/faked** | `DockerRunner` is a real primitive but prod worker logic "routed to Python `runner/worker.py`"; real-container test is opt-in (`AEDEV_SMOKE_DOCKER=1`), default-skipped |
| GitHub remote-write / autonomous PR | 25% | **Never live** | `GitRemoteWriter.pushBranch` is an interface; `routes/operator.ts:212` throws "real git push adapter is not configured" unless `FAKE_PR=1` returns `example.invalid`; Gate 8 unverified |
| Observability / recovery | 60% | Partial-real | holds (`interrupt-bus`), ntfy (`approval-v2`), alerts, replay exist; but runbooks stale |
| Install / 24/7 boot (launchd) | 20% | **Broken path** | only `.tpl` templates in `scripts/launchd/`; **`install_launchd.sh`/`uninstall_launchd.sh` do not exist** (verified); `docs/INSTALL.md` describes wrong runtime (Python, port 8423 vs TS 7247) |
| Real-clock soak / stability | 20% | **Synthetic only** | all soaks compressed/dry (`soak-k-full` = 800 ticks in 171 ms; `mission-os-dry-soak` = in-memory, 3 iters); no real 24–72 h run; ADR-0013 concedes this |
| Secrets enforcement (ADR-0007) | 15% | **Types only** | `packages/secrets/src/index.ts` = **17 lines of interfaces** (verified); no grant/TTL/revoke/inject engine |
| Docs accuracy (INSTALL/OPERATIONS) | 40% | Stale | reference a missing install script + Python/port-8423 runtime |

**Weighted overall toward Bar B: ~55%.** Toward Bar A (supervised RC): the project is essentially there, which is exactly what ADR-0013 claims.

---

## 2. Why it's not Bar B yet — the three hard blockers

1. **No working install/boot path.** The launchd install scripts referenced across the docs are absent, and INSTALL/OPERATIONS describe the old Python runtime. You cannot stand up the 24/7 daemon by following the docs. A "24/7 product" that can't be installed isn't one yet.
2. **The core value loop is faked end-to-end.** Real Docker worker execution and the GitHub remote-write/draft-PR path have **no production adapter wired** — both throw or return synthetic results unless a `FAKE_*`/`SMOKE_*` flag is set, or they bridge to the Python kernel. The system has **never autonomously pushed a branch or opened a PR against a real repo.**
3. **No real-clock stability evidence + secrets unenforced.** Every soak is a sub-second/in-memory simulation; ADR-0007 secret grants are types-only. For unattended operation you need both: proof it survives days, and a real secret lifecycle.

None of these are architecture problems — the design and the safety rails are good. They're "the last mile is stubbed" problems.

---

## 3. What's genuinely good (don't rebuild these)

- **Safety-first invariants are real and test-enforced** — no auto-merge without two real validators, no self-approval, forbidden-path + secret-pattern guards, draft-PR gate. The cockpit live smoke this session confirmed the gate holds on the real path.
- **Event-sourced three-plane architecture** with 17 ADRs documenting decisions and honesty flags (the repo tracks its own lies — rare and valuable).
- **Clean unit/integration test discipline** (91 test files, green typecheck/test/lint, `no-only-skip` CI guard).
- **Honest self-documentation** — roadmap says Phase 0, parity-status tracks the bridge, ADR-0013 retracts a premature GA tag. The project does not lie to itself; keep that culture.

---

## 4. Risk register (top items)

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Operator believes "rc-grade = prod" and runs it unattended with `allow_remote_writes=true` before the push adapter is real | Med | High | Keep remote writes OFF until P3 lands + a real disposable-repo PR test passes |
| Dirty working tree mixes cockpit work with pre-existing runtime edits; risk of losing/confusing changes | High | Med | Commit in scoped groups now (P0) |
| Stale INSTALL/OPERATIONS docs lead to a broken/insecure manual setup | Med | Med | Fix docs in P0/P1 before anyone follows them |
| Python-bridge retirement assumed done; it isn't | Med | High | Treat Gate 10 / bridge retirement as P2, gated by a real worker run |
| "Soak passed" misread as real-clock | Med | High | Label all synthetic soaks; require a real ≥24 h run (P5) before any GA tag |

---

## 5. Plan to production (staged, with acceptance gates)

Each stage is independently shippable and ends with an **evidence file** under `evidence/`. Keep all current safety invariants. Do not create a GA tag until P6.

### P0 — Housekeeping (0.5 day)
- Commit the current cockpit branch in scoped groups; separate the pre-existing runtime changes (runner/validator/mission-runner/SSE) from the cockpit set.
- Fix `docs/INSTALL.md` + `docs/OPERATIONS.md` to describe the **TS daemon on :7247** (delete the Python/port-8423 instructions or move them to an archive note).
- **Accept:** `git status` clean or intentionally grouped; docs match the running daemon.

### P1 — Install & boot (1–2 days)
- Write real `scripts/install_launchd.sh` + `uninstall_launchd.sh` from the `.tpl` files; wire `scripts/doctor.sh` and `aedev daemon status`.
- **Accept:** on a fresh shell, install → daemon runs under launchd → survives logout/reboot → `doctor.sh` green → uninstall removes it cleanly. Evidence: `evidence/launch/install-boot-<date>.md`.

### P2 — Real worker loop (retire the Python bridge for the core path) (3–5 days)
- Make `DockerRunner` (or the local-CLI runner) execute a **real coding worker** against an isolated clone and produce a real diff + evidence — no `runner/worker.py` bridge on the happy path.
- **Accept:** a real task yields a real branch diff + evidence bundle with `runnerMode != claude247-bridge`. Evidence: `evidence/launch/real-worker-<date>.md`.

### P3 — Real GitHub remote-write path (2–3 days)
- Implement `GitRemoteWriter.pushBranch` (real `git push`) + draft-PR creation via Octokit, wired behind `allow_remote_writes` + forbidden-path gate.
- **Accept:** in a **disposable** GitHub repo with `allow_remote_writes=true`, an autonomous run creates a **real draft PR**, never merges, is idempotent on retry, and stays blocked when the flag is false. This closes parity **Gate 8**. Evidence: `evidence/launch/real-draft-pr-<date>.md`.

### P4 — Secrets enforcement (ADR-0007) (2 days)
- Replace types-only `packages/secrets` with a grant/TTL/revoke/inject engine; pause tasks that need a secret until granted.
- **Accept:** a secret-required task pauses for an auditable, time-limited, revocable grant; expired grants block; nothing is logged in plaintext. Evidence + tests.

### P5 — Real-clock soak (≥24 h, target 72 h) (elapsed, low effort)
- Run the **real daemon under launchd** for ≥24 h with periodic synthetic missions; capture uptime %, hold count + resolution, cost tracking, memory.
- **Accept:** no crash/restart loop; holds auto-escalated; `daemon_uptime_pct_7d` measured for real. Evidence: `evidence/launch/real-soak-<date>.md` (this is the thing ADR-0013 deferred).

### P6 — GA gate (1 day)
- Dual-validator on a real evidence bundle in CI; security review (`/security-review`); docs verified accurate; then reopen ADR-0013 and cut a real GA tag.
- **Accept:** all of P1–P5 evidence present; CI runs at least one non-mock smoke; a signed GA decision ADR.

**Critical path to a credible "production for single-operator 24/7" claim: P1 → P2 → P3 → P5.** P4 and P6 can trail.

---

## 6. Recommendation

- **Today:** safe to use as a **supervised, single-operator assistant** (planning + cockpit + dual-validation), with `allow_remote_writes=false`. That's the Bar A that ADR-0013 legitimately claims.
- **Do not** point it at real repos unattended with remote writes until **P3** lands and its disposable-repo evidence exists.
- Sequence the work as P0→P3 first (that's the autonomous loop becoming real), then P5 (proof it lasts).

See the companion workbook handoff for the next-session execution slice: `docs/handoff/production-hardening-workbook-handoff-2026-05-29.md`.
