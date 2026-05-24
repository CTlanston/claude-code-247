# M19 — Beta Stabilization Report

**Status**: IN PROGRESS · Phase 0 complete · Phase 1+ pending user go-ahead
**Branch**: `claude247/v1`
**Predecessor tag**: `v1.0.0-beta.0` → commit `d50949f` (M18-P4)
**Target tag** (after M19): `v1.0.0-beta.1` (gated on Phase 4+5 clean)

---

## Phase 0 — Remote/tag/release consistency check

### Required diagnosis fields

| Field | Value |
|---|---|
| Local branch | `claude247/v1` |
| Local HEAD | `f2f7e7094ec531120f4af2e9627afebd3375433f` (= `f2f7e70`) |
| Origin URL | `https://github.com/CTlanston/claude-code-247.git` |
| Remote default branch | `main` |
| Remote `claude247/v1` SHA | `f2f7e70` (✅ in sync with local HEAD) |
| Remote `main` SHA | `cd563e8` (= M17 commit — **6 commits behind `claude247/v1`**) |
| Local `v1.0.0-beta.0` tag SHA | annotated `fb4d600` → commit `d50949f` |
| Remote `v1.0.0-beta.0` tag SHA | annotated `fb4d600` → commit `d50949f` (✅ matches local) |
| GitHub Release `v1.0.0-beta.0` exists | **YES (created in M19-P0)** — https://github.com/CTlanston/claude-code-247/releases/tag/v1.0.0-beta.0 |
| Mismatch found | **(1)** GitHub Release object was missing for `v1.0.0-beta.0` (tag was pushed, but no Release published). **(2)** Default branch `main` is 6 commits behind `claude247/v1` — anyone visiting the public repo page sees the M17-era README. |
| Fix applied | **(1) ✅ Fixed** — `gh release create v1.0.0-beta.0 --prerelease --notes-file RELEASE_NOTES_BETA0.md` succeeded; verified via `gh release view`. **(2) DEFERRED** — per user instruction, `claude247/v1` → `main` merge happens after M19 closes cleanly (Phase 4 + Phase 5 pass). |

### What's on `main` vs `claude247/v1`

Commits on `claude247/v1` not yet on `main` (in chronological order, oldest first):

```
334ed46  feat(m18-p0): explicit worker_mode + no silent API fallback
9dacd5d  feat(m18-p1): mock validators cannot silently count for auto-merge
712a639  feat(m18-p2): launchd hardening — doctor_launchd.sh + doctor launchd check + plist tests
5170197  feat(m18-p3): live ngrok webhook validation + explicit ping handler
d50949f  docs(m18-p4): second live E2E + beta-readiness synthesis   ← v1.0.0-beta.0 points here
f2f7e70  docs(dod): record M18 beta-readiness items 50..54 + backlog BR-001..003   ← current HEAD
```

### Explanation of the user's "No releases published" observation

The user reported that the public GitHub page showed an old Docker Compose README and "No releases published". Diagnosis:

- The **default-branch README** the user saw is from `cd563e8` (M17 era) because `main` has not advanced past M17. This is independent of the tag/release state.
- The **`v1.0.0-beta.0` tag IS pushed** (verified by `git ls-remote --tags origin`). It lives on commit `d50949f` which is reachable through `claude247/v1` but not through `main`.
- However, **no GitHub Release object was ever created from that tag**. The `gh release list` output confirms only `alpha.0` and `alpha.1` exist as published Release objects. The Releases page would therefore show alpha.1 as "Latest" and beta.0 would only appear under the Tags tab — easy to miss, and easy to read as "no beta release" at a glance.

So both screenshot claims are technically correct from different angles:
- "tagged and pushed" → ✅ true (the annotated tag is on origin).
- "No releases published" → ✅ true for the Release object (the tag exists, but no Release was created from it).

### Decisions taken (user confirmed)

**A. ✅ Create GH Release for `v1.0.0-beta.0`** — done. Pre-release flag set. Notes published in [RELEASE_NOTES_BETA0.md](RELEASE_NOTES_BETA0.md).

**B. ⏸ Merge `claude247/v1` → `main` deferred until after M19** — per user instruction. M19 will continue to land on `claude247/v1`; `main` fast-forward will happen as part of `v1.0.0-beta.1` release.

**C. ✅ `v1.0.0-beta.0` tag not moved** — annotated tag stays on `d50949f` (M18-P4). M19 outcome will ship as `v1.0.0-beta.1`.

---

## Pre-Phase 5 risk surfaced now (so we don't discover it later)

Doctor output shows:

```
• validator API keys: neither GEMINI_API_KEY nor OPENAI_API_KEY set;
  validators will use mocks
```

The Phase 5 E2E is required to demonstrate **real validators receiving the BR-001 diff body**. With both API keys missing:

- Worker still runs in `local_claude_code` mode (`worker_mode=local_claude_code, usable=True` — verified).
- Both validators will be **mocked**.
- M18-P1 gate (mock validators cannot silently count for auto-merge) will (correctly) refuse auto-merge → `NEEDS_HUMAN`.
- This means Phase 5's question "Did real validators PASS?" will be **NO**, and "Did auto-merge happen?" will be **NO**.

This is not a system bug — it's an environment gap. The user needs to decide before Phase 5:

1. **Option A (preferred for beta proof)**: load `GEMINI_API_KEY` (and ideally `OPENAI_API_KEY`) into `~/.claude-code-247/secrets.env` or env so Phase 5 exercises real validators.
2. **Option B**: run Phase 5 with mocks, accept the NEEDS_HUMAN verdict as expected, document explicitly that real-validator demonstration is deferred to a future E2E.

The system already had this situation in M18-P4 (Gemini real, OpenAI mock → NEEDS_HUMAN as correctly recorded). M19 BR-001 fixes the *validator input* side, but does not fix the *missing keys* side.

---

## Phase 1 — BR-001 status: ✅ DONE

Safe diff body now produced and wired into validator input.

**Code**:
- `runner/evidence_collector.py`: new `snapshot_diff_body_safe()` method
  - `DEFAULT_FORBIDDEN_PATTERNS` floor (`.env`, `secrets/**`, `.github/**`,
    `CLAUDE.md`, `AGENTS.md`, PEM/key files) merged with `task_spec.forbidden_paths`
  - Per-file `git diff` filtered through `orchestrator.secret_scanner.scan`
  - If any secret hits → body redacted to summary-only + `secret_scan.status = BLOCKED`
  - Per-file + total byte caps with `TRUNCATED` marker
  - `diff_body_metadata.json` records `files_changed`, `included_in_diff_body`,
    `omitted_reason`, `secret_scan.{status,hits}`, `diff_body_truncated`
- `validator/judge_contract.py`: `JudgeInput.diff_body_safe` + `.diff_body_metadata`;
  `evidence_prompt()` adds `## DIFF_BODY` section + directive-mandated instruction
  ("may inspect", NEEDS_HUMAN-on-missing, no-hidden-conversation)
- `runner/worker.py`: calls `snapshot_diff_body_safe()` at both diff-snapshot sites,
  forwarding `task_spec.forbidden_paths`

**Tests** (18 new):
- `tests/unit/test_evidence_diff_body_safe.py` (7 tests)
- `tests/unit/test_validator_receives_diff_body.py` (7 tests)
- `tests/unit/test_secret_hit_blocks_diff_body_validator.py` (4 tests)
- 1-line tweak to `tests/unit/test_judge_contract.py` to allow the
  "do not ask for hidden conversation" meta-instruction (the original
  guard against literal "conversation" substring was too broad)

**Test posture**: 437 passing (up from 419 baseline).

## Phase 2 — BR-002 status: NOT STARTED
## Phase 3 — BR-003 status: NOT STARTED
## Phase 4 — Full tests: NOT STARTED
## Phase 5 — Third real E2E: NOT STARTED (gated)
## Phase 6 — Tag v1.0.0-beta.1: NOT STARTED (gated)

---

## Final answers (will be filled in as phases close)

1. Is remote/tag/release state consistent? — **NO** (Release object missing; main divergence). See above.
2. Was BR-001 fixed? — PENDING
3. Was BR-002 fixed? — PENDING
4. Was BR-003 fixed? — PENDING
5. Did all tests pass? — PENDING
6. Did third real E2E run? — PENDING
7. Did validators receive diff body? — PENDING
8. Did real validators PASS? — PENDING (gated on validator-key decision above)
9. Did auto-merge happen? — PENDING
10. If not, exactly why? — PENDING
11. Was Anthropic API spend still $0? — PENDING (baseline: $0.00 in M18-P4)
12. Is this now beta.1-ready? — **NO** — not yet. Target after Phase 4+5 clean.
