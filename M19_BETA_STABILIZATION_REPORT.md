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

## Phase 2 — BR-002 status: ✅ DONE

Deterministic env + config resolution.

**Locked precedence** (mirrored in tests):

- **Config YAML**: CLI `--config` → `$CLAUDE247_CONFIG` → `$CLAUDE247_CONFIG_DIR/config.yaml` (default `~/.claude-code-247/config.yaml`) → `<cwd>/.claude247/config.yaml`.
- **Env values**: already-set `os.environ` > project-root `.env` > CWD `.env` > `<config_dir>/.env`. Among `.env` files, first-wins.

**Code**:
- `orchestrator/config.py`: new `resolve_config_path(cwd, explicit)` + `EXPLICIT_CONFIG_ENV = "CLAUDE247_CONFIG"`
- `orchestrator/env_loader.py`:
  - `discover_env_paths(cwd, project_root)` returns ordered candidate paths
  - `load_chain(paths)` — first-wins semantics
  - `RuntimeConfig` dataclass: `cwd`, `config_source`, `config_source_kind`,
    `env_files_loaded`, `env_keys_applied` (names only — never values),
    `worker_mode`, `allow_api_fallback`, `*_key_present` flags, paths
  - `load_runtime_config(cwd, explicit_config, project_root, apply_env)` 
    composes the above without echoing secret values
- `gateway/doctor.py`: new `check_config_source()` probe surfaces RuntimeConfig
  in both `--plain` and `--json` output
- `scripts/launchd/*.plist.tpl` (all 4): added `<key>CLAUDE247_CONFIG</key>` 
  to `EnvironmentVariables` so launchd-launched workers resolve config 
  without shell profile

**Tests** (28 new):
- `tests/unit/test_env_loader_precedence.py` (7)
- `tests/unit/test_env_loader_cwd_support.py` (7)
- `tests/unit/test_doctor_reports_config_source.py` (5)
- `tests/unit/test_launchd_plist_sets_config_env.py` (9 — 4×2 parametrized + 1)

**Test posture**: 465 passing (up from 437 after Phase 1).
## Phase 3 — BR-003 status: ✅ DONE

Per-phase worker exit observability.

**Code**:
- `memory/schema.sql`: new `worker_exits` table (per directive schema)
  + indexes on `(task_id, created_at)` and `(classification, created_at)`.
  Bumped `schema_version` to 3 (additive — idempotent re-init on existing DBs).
- `orchestrator/worker_exits.py` (new module):
  - `CLASSIFICATIONS` frozenset of canonical labels (success, test_failure,
    lint_failure, build_failure, claude_cli_failure, auth_failure,
    docker_failure, git_failure, github_failure, validator_failure,
    merge_policy_block, timeout, policy_block, unknown_failure)
  - `WorkerExit` dataclass + `record_worker_exit(...)` writer (raises
    ValueError on unknown classification to surface typos)
  - `list_worker_exits(task_id, limit)` chronological reader
  - `classify_failure(phase, exit_code, command, stderr_tail, verdict)`
    heuristic — order: merge_policy_block → timeout → success → auth
    markers → command-head (claude/gh/git/docker) → phase fallback
    (tests/lint/build/validate) → unknown_failure
- `runner/evidence_collector.py`: `run_named_commands` now writes a
  worker_exits row per command when task_spec carries task_id + repo_id.
  Best-effort — DB errors never propagate to the worker.
- `orchestrator/dispatcher.py::handle_explain_stuck`: surfaces
  `worker_exits` in the returned summary so the operator sees phase,
  classification, stderr_tail, next_action without spelunking logs.
  Adds `claude247 worker-exits --task <id>` to the suggested safe commands.
- `gateway/commands/worker_exits_cmd.py` (new): `claude247 worker-exits
  --task <id>` with `--plain` and `--json` output modes.
- `gateway/cli.py`: registered the new command.

**Tests** (25 new):
- `tests/unit/test_worker_exit_record.py` (7)
- `tests/unit/test_worker_exit_classification.py` (13)
- `tests/unit/test_explain_stuck_uses_worker_exit.py` (3)
- `tests/integration/test_failed_worker_writes_exit_record.py` (2)

**Test posture**: 490 passing (up from 465 after Phase 2).

**Scope note**: this PR instruments the highest-leverage call site
(`evidence_collector.run_named_commands` — tests/lint/build phases) and
ships the table + recorder + classifier + CLI + explain-stuck wiring.
Deeper per-phase instrumentation (workspace prepare, branch, push,
open_pr, merge gate calls) is left for incremental follow-ups; the
infrastructure is in place so each addition is a one-line `record_worker_exit`
call.
## Phase 4 — Full tests: ✅ DONE

### `pytest -q --no-cov`

```
490 passed in 12.61s
```

### `claude247 doctor`

```
✓ macOS host: Darwin 25.3.0
✓ python >= 3.11: python 3.13.13
✓ git: git version 2.50.1 (Apple Git-155)
• docker: docker CLI found but daemon not reachable
✓ gh auth: gh authenticated
✓ claude CLI: 2.1.142 (Claude Code)
✓ config source: loaded /Users/lanston/.claude-code-247/config.yaml (kind=user); env files probed: 2
✓ auth mode: worker_mode=local_claude_code, usable=True — local Claude Code CLI available
✓ sqlite3 (python): sqlite3 3.53.1
✓ state dir writable: /Users/lanston/.claude-code-247
✓ sqlite db init: schema v3 at /Users/lanston/.claude-code-247/state/claude247.db
✓ repos.yaml: 1 repo(s) registered
✓ dashboard port free: 127.0.0.1:8423 available
✓ ntfy notifications: topic configured: claude-code-247-auto-evo
• validator API keys: neither GEMINI_API_KEY nor OPENAI_API_KEY set; validators will use mocks
• launchd: none of com.claude247.* services loaded
OK
```

Key BR-001/2/3 evidence:
- **schema v3** at `claude247.db` (BR-003 migration applied cleanly)
- **config source** check present in doctor output (BR-002 working)
- `kind=user` source resolved from `~/.claude-code-247/config.yaml`
- `env files probed: 2` — both the user `.env` and the project-local `.env` (the original BR-002 bug — they're now discovered)
- `worker_mode=local_claude_code` (M18-P0 invariant preserved)
- Anthropic API key NOT present in env → no risk of silent fallback

### `claude247 status --plain`

```
System: running
Repos enabled: 1
Active tasks: 0
Stuck tasks: 0
Need approval: 1
Today: 1 completed, 1 failed
Next actions:
- claude247 approve-merge --repo auto-evo-playground --pr 53
```

Mobile-readable ✓. The "1 failed" / "Need approval: 1" lines refer to historical M17/M18 fixtures still in the DB; not M19 work.

### Pre-Phase 5 reminder

Doctor explicitly reports `neither GEMINI_API_KEY nor OPENAI_API_KEY set; validators will use mocks`. Per user instruction earlier: "if no keys, do not claim beta E2E auto-merge proof". Phase 5 will be run with whichever keys the user supplies; if none, Phase 5 will document mock-validator behavior honestly.

## Phase 5 — Third real E2E: ✅ DONE (with one new finding)

Full report: [REAL_E2E_REPORT_M19.md](REAL_E2E_REPORT_M19.md).

**Summary**:
- Task `task_01KSDR1DGG4DV8XNGZSR7506QC` queued via `claude247 start`,
  driven by `claude247 dispatcher --once`, ran the entire pipeline.
- Worker produced a correct `dedupe_words(text)` implementation + 7
  tests; workspace pytest 86 passing.
- **PR**: [auto-evo-playground#54](https://github.com/CTlanston/auto-evo-playground/pull/54) (draft, pending approval).
- **Worker auth**: `local_claude_code` (subscription). **Anthropic
  spend: $0.00.** M18-P0 invariant held.
- **BR-001** fired live: `diff_body_safe.md` + `diff_body_metadata.json`
  produced. Body was REDACTED because of a secret-scan hit (see
  Finding M19-F1 below).
- **BR-002** confirmed live: `GEMINI_API_KEY` was picked up from
  `~/.claude-code-247/.env` (the new env_loader chain), so the **real**
  Gemini judge ran. OpenAI ran as `openai-mock` (no key).
- **BR-003** confirmed live: 3 `worker_exits` rows written (all
  `tests` phase, `success`); `claude247 worker-exits` lists them.
- **M18-P1** held: mock validator + redacted body → Gemini honestly
  returned `NEEDS_HUMAN` → merge policy routed to `WAITING_APPROVAL`.
  No auto-merge.

### Finding M19-F1 (resolved by M19-P5b)

`orchestrator/secret_scanner.py`'s `env_var_assign` regex used `(?im)`
which made the Python line `+    tokens = text.split()` match (`tokens`
→ case-insensitive `TOKEN` + `s`; ` = ...` → `\s*=\s*\S+`). Result:
BR-001 redacted clean code, capping real-validator PASS rate.

**Fix shipped as M19-P5b (commit `396c153`)**: removed the `i` flag.
Regression tests added in `tests/unit/test_secret_scanner.py`:
- `test_m19_f1_lowercase_python_var_not_flagged_as_env_var` proves
  `+    tokens = text.split()`, `+secret_text = redact()`,
  `+password_hash = derive(salt)`, `+Token = make()` are no longer flagged.
- `test_m19_f1_uppercase_env_var_still_caught` preserves the legitimate
  match on `+SECRET_TOKEN=`, `+API_KEY=`, `+TOKEN=`, `+PASSWORD=`,
  `+PASSWORD_HASH=`.

### Phase 5 rerun (post-M19-F1 fix)

Second E2E (`task_01KSDRQDNN29FSNRYYSFC4G59J`, PR
[auto-evo-playground#55](https://github.com/CTlanston/auto-evo-playground/pull/55))
ran with the M19-P5b fix in place:

- `diff_body_metadata.secret_scan.status` = **`PASS`** (no false positive)
- `diff_body_safe.md` contains the **full unified diff** including the
  `tokens = text.split()` line that previously triggered redaction
- **Gemini real verdict: `PASS`, confidence 1.0** — top-shelf
  validator was given the actual diff body and judged it correctly
- OpenAI still mock (no key) → `NEEDS_HUMAN` → validator DISAGREE →
  risk 40 (medium, from `validator_disagreement` factor) →
  `WAITING_APPROVAL` (two-layer correct hold)
- Worker auth: `local_claude_code`. **Anthropic spend: $0.00** across both runs.

**Test posture**: 492 passing (was 490 before M19-P5b regression tests).

## Phase 6 — Tag v1.0.0-beta.1: ready to execute (still GATED on user OK)

---

## Final answers

1. Is remote/tag/release state consistent? — ✅ **Yes** (M19-P0 created beta.0 GH release; main fast-forward deferred to beta.1 per user instruction).
2. Was BR-001 fixed? — ✅ **Yes** (code + 18 tests, surfaced + fixed Finding M19-F1, rerun showed unredacted diff body + real Gemini PASS).
3. Was BR-002 fixed? — ✅ **Yes** (code + 28 tests; GEMINI_API_KEY pickup from `~/.claude-code-247/.env` verified live in both E2E runs).
4. Was BR-003 fixed? — ✅ **Yes** (code + 25 tests; 3 rows written per E2E task, `claude247 worker-exits` works).
5. Did all tests pass? — ✅ **492 passing** (419 baseline → +73 across M19 phases).
6. Did third real E2E run? — ✅ **Twice** (PRs #54 and #55 on auto-evo-playground).
7. Did validators receive diff body? — ✅ Yes (first run: redacted summary per security rule; rerun: full unified diff).
8. Did real validators PASS? — ✅ **Yes (rerun)** — Gemini PASS, confidence 1.0.
9. Did auto-merge happen? — ❌ No, correctly. Two-layer hold: (a) M18-P1 (openai-mock can't auto-merge); (b) `validator_disagreement` → medium risk → `WAITING_APPROVAL`.
10. If not, exactly why? — see above. Per user instruction "if no keys, do not claim beta E2E auto-merge proof": we don't claim it.
11. Was Anthropic API spend still $0? — ✅ **$0.00 across both E2E runs.**
12. Is this now beta.1-ready? — ✅ **Yes.** All three backlog items closed, Finding M19-F1 surfaced + fixed + regression-tested + verified live. Awaiting your final OK to tag `v1.0.0-beta.1`.
