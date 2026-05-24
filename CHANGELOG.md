# Changelog

All notable changes to `claude-code-247` are recorded here.
Pre-1.0 releases are pre-release on GitHub.

## [Unreleased] — proposed v1.0.0-beta.2

Production-proof milestone (M20). Not tagged yet (awaiting operator
confirmation). See [M20_PRODUCTION_PROOF_REPORT.md](M20_PRODUCTION_PROOF_REPORT.md).

### Headline

- **Pure auto-merge proven live** on `CTlanston/auto-evo-playground#59`
  with **both real validators returning PASS conf 1.0**. Worker stayed
  on `local_claude_code`; Anthropic worker spend $0.00.

### Added

- launchd daemon mode installed and verified (4 services: dashboard
  KeepAlive + orchestrator/dispatcher/backup scheduled). See
  [M20_SOAK_PLAN.md](M20_SOAK_PLAN.md) for the 24h soak baseline.

### Fixed (M20-P1b through M20-P3j)

- **M20-P1b** (`5aed874`): `env_loader.discover_env_paths()` now
  probes `<user_config_dir>/secrets.env` so launchd-spawned daemons
  see the operator's secret store. Also strips `export VAR=value`
  bash-style prefix so the resulting env var has a real name.

- **M20-P3b** (`1eb9d10`): `dispatcher_cmd.py` now calls
  `env_loader.load_chain(discover_env_paths(cwd=None))` instead of the
  legacy single-file `load()` — so the full BR-002 + M20-P1b chain
  takes effect at dispatcher startup.

- **M20-P3d**: default OpenAI validator model `gpt-5` → `gpt-4o`.
  `gpt-5` requires org verification; `gpt-4o` is widely available
  and supports `response_format: json_object` which the judge needs.

- **M20-P3g** (`1c18d49`): `EvidenceCollector.snapshot_diff` /
  `snapshot_diff_body_safe` resolve base ref from
  `task_spec.default_branch` (with `origin/<branch>` and `HEAD`
  fallbacks) instead of always using `HEAD`. Necessary because the
  Claude CLI worker now commits its work mid-roleloop, so `git diff
  HEAD` returns empty.

- **M20-P3i** (`ef30853`): `snapshot_diff_body_safe` includes
  untracked files via `git ls-files --others --exclude-standard`,
  synthesizing new-file diffs. The Claude CLI worker often writes
  new files without staging; without this, the safe diff body was
  empty even after M20-P3g.

- **M20-P3j** (`cca1858`): `runner/role_loop.py` calls a new
  `_refresh_diff_evidence` helper after the coder finishes and
  after each repair attempt. Without this, the role_loop's internal
  reviewer read pre-coder snapshots and cascaded to NEEDS_HUMAN even
  when the work was correct; the stale `review.md` then misled the
  external OpenAI validator.

### Testing

- 502 passing (was 497 at beta.1).

## [v1.0.0-beta.1] — 2026-05-24

Beta stabilization. M19. Eight commits on top of beta.0.
See [RELEASE_NOTES_BETA1.md](RELEASE_NOTES_BETA1.md) and
[M19_BETA_STABILIZATION_REPORT.md](M19_BETA_STABILIZATION_REPORT.md).

### Added

- **BR-001 — Safe diff body to validators** (M19-P1, `c6d6aeb`).
  `.evidence/diff_body_safe.md` + `diff_body_metadata.json` produced by
  every worker run; redacted to a summary when secrets are detected.
  `JudgeInput.diff_body_safe` surfaced to Gemini + OpenAI prompts.
- **BR-002 — Deterministic env + config resolution** (M19-P2, `b65e7f6`).
  New `RuntimeConfig` + `load_runtime_config()` honor the documented
  precedence chain: CLI `--config` > `$CLAUDE247_CONFIG` > user
  `config.yaml` > repo `.claude247/config.yaml`. .env discovery now
  walks project-root + CWD + user, with first-wins among files.
- **BR-003 — Per-phase `worker_exits` observability** (M19-P3, `687144c`).
  New `worker_exits` SQLite table (schema v3) + `record_worker_exit()`
  + `classify_failure()` heuristic + `claude247 worker-exits` CLI.
  `handle_explain_stuck` now surfaces phase + classification +
  stderr_tail + next_action.
- `claude247 doctor` gained a `config source` probe (BR-002).
- Release notes published as a Release object for `v1.0.0-beta.0`
  (was missing from beta.0 ship; created in M19-P0, `e2766f2`).

### Fixed

- **M19-F1**: `orchestrator/secret_scanner.py`'s `env_var_assign`
  regex used `(?im)`, which made ordinary lowercase Python variable
  names like `tokens = text.split()` match (`tokens` →
  case-insensitive `TOKEN` + `s`). Result: BR-001 was redacting clean
  diffs, capping real-validator PASS rate. Fixed by removing the `i`
  flag (M19-P5b, `396c153`). Regression-tested.

### Validated live

Two E2E runs against `CTlanston/auto-evo-playground` ([#54](https://github.com/CTlanston/auto-evo-playground/pull/54),
[#55](https://github.com/CTlanston/auto-evo-playground/pull/55)).
First run surfaced M19-F1; second run (post-fix) had Gemini return
real `PASS` conf 1.0 on the actual diff body. Anthropic spend = $0.00
across both runs (`worker_mode = local_claude_code`).

### Testing

- 492 passing (was 419 at beta.0; +73 across M19 phases).

## [v1.0.0-beta.0] — 2026-05-24

Beta-readiness milestone. M18. See
[BETA_READINESS_REPORT.md](BETA_READINESS_REPORT.md) and
[RELEASE_NOTES_BETA0.md](RELEASE_NOTES_BETA0.md).

### Added

- **M18-P0**: explicit `worker_mode` config + no silent
  `ANTHROPIC_API_KEY` fallback. `runner/auth.py::resolve_worker_mode`
  + `effective_env`. Doctor reports the resolved mode.
- **M18-P1**: real OpenAI REST validator (httpx-based) +
  mock-cannot-silently-count-for-auto-merge gate
  (`validators.allow_mock_validators_for_auto_merge: false` default).
- **M18-P2**: launchd hardening — `scripts/doctor_launchd.sh` +
  doctor `launchd` check + plist generation tests.
- **M18-P3**: live ngrok webhook validation + explicit `handle_ping`
  in `orchestrator/webhooks.py`.

### Validated live

Second E2E proving the local-first auth path drives a real PR end-to-end
on `auto-evo-playground` at **$0.00 Anthropic spend** (vs ~$1.50 in
α1 for similar-shape work). Auto-merge gate correctly held on the
NEEDS_HUMAN verdict (real Gemini + redaction policy).

### Testing

- 419 passing.

## [v1.0.0-alpha.1] — 2026-05-24

Real multi-repo E2E validation. M17. See
[REAL_E2E_REPORT.md](REAL_E2E_REPORT.md).

PR #51 on `auto-evo-playground` opened + merged through the full
pipeline. Real Gemini validator, mock OpenAI; 368 + 15 tests passing.
Six live-discovery fixes shipped:
1. claude CLI 2.1.142 prompt-via-stdin handling.
2. Honest auth_mode detection.
3. `python3 -m pytest` spec guidance.
4. `gh pr merge --auto` opt-in.
5. `gh pr merge --admin` opt-in.
6. `gh pr ready` auto-called before merge.

## [v1.0.0-alpha.0] — 2026-05-24

Production v1 transformation complete. M1–M16. Initial public
pre-release. Legacy Auto-Evo + AutoDev v3 system archived under
`archive/auto-evo/`. Full rewrite covering orchestrator + runner +
validator + memory + gateway + dashboard.
