## v1.0.0-beta.1 — Beta stabilization

Eight-commit milestone (M19) built on top of [v1.0.0-beta.0](https://github.com/CTlanston/claude-code-247/releases/tag/v1.0.0-beta.0). The job was **not** to add product features — it was to close the three beta-readiness backlog items, prove BR-001 + BR-002 + BR-003 working end-to-end on a real GitHub repo, and ship release+main consistency so the public page reflects reality.

See [M19_BETA_STABILIZATION_REPORT.md](https://github.com/CTlanston/claude-code-247/blob/main/M19_BETA_STABILIZATION_REPORT.md) and [REAL_E2E_REPORT_M19.md](https://github.com/CTlanston/claude-code-247/blob/main/REAL_E2E_REPORT_M19.md) for the full synthesis.

## What's in

| Phase | Title | Commit |
|---|---|---|
| M19-P0 | Remote consistency report + missing GH release for beta.0 | `e2766f2` |
| M19-P1 | **BR-001** — safe diff body to validators | `c6d6aeb` |
| M19-P2 | **BR-002** — deterministic env + config resolution | `b65e7f6` |
| M19-P3 | **BR-003** — per-phase worker_exits observability | `687144c` |
| M19-P4 | Full test pass + doctor + status recorded | `1e53ce2` |
| M19-P5 | Third real E2E (first run surfaced finding M19-F1) | `71dbb40` |
| M19-P5b | **Fix M19-F1**: secret_scanner false-positive on lowercase Python vars | `396c153` |
| M19-P5c | E2E rerun proving fix in production: Gemini real PASS conf 1.0 | `17cffac` |

## What this delivers

**BR-001 — Safe diff body to validators**
- New `EvidenceCollector.snapshot_diff_body_safe()` produces
  `.evidence/diff_body_safe.md` and `.evidence/diff_body_metadata.json`.
- Default forbidden-path floor (`.env`, `secrets/**`, `.github/**`,
  `CLAUDE.md`, `AGENTS.md`, PEM/key files) merged with task spec.
- Per-file `git diff` filtered through `orchestrator.secret_scanner`;
  any hit → body redacted to a summary + `secret_scan.status = BLOCKED`.
- Per-file and total byte caps with truncation marker.
- `JudgeInput` gained `diff_body_safe` + `diff_body_metadata`;
  `evidence_prompt()` adds a `## DIFF_BODY` section + the directive
  instruction telling the validator to return NEEDS_HUMAN if the body
  is insufficient.

**BR-002 — Deterministic env + config resolution**
- New precedence chain for config:
  `CLI --config > $CLAUDE247_CONFIG > $CLAUDE247_CONFIG_DIR/config.yaml > <cwd>/.claude247/config.yaml`
- New precedence chain for env values: already-set os.environ wins
  absolutely; among .env files, project-root .env > CWD .env >
  `<config_dir>/.env`.
- New `RuntimeConfig` dataclass surfaced via doctor for diagnostics.
- launchd plists now set `CLAUDE247_CONFIG` so launchd-launched
  workers resolve config without shell profile.

**BR-003 — Per-phase worker_exits observability**
- New `worker_exits` SQLite table (schema v3, additive migration).
- New `classify_failure(phase, exit_code, command, stderr, verdict)`
  heuristic returns one of 14 canonical labels (test_failure,
  claude_cli_failure, auth_failure, docker_failure, git_failure,
  github_failure, validator_failure, merge_policy_block, timeout,
  policy_block, …, unknown_failure).
- `evidence_collector.run_named_commands` writes a row per command.
- `handle_explain_stuck` surfaces `worker_exits` in its summary.
- New `claude247 worker-exits --task <id>` CLI with `--plain` / `--json`.

**M19-F1 — Secret scanner false positive fixed**
- The pre-existing `env_var_assign` regex used `(?im)`, which made
  ordinary Python `tokens = text.split()` match (`TOKEN` + `s`,
  case-insensitive). Removed the `i` flag so only conventional
  all-uppercase env-var names match. Regression-tested.

## Validated against CTlanston/auto-evo-playground

Two live E2E runs of the same task (`dedupe_words`):

| Field | Run 1 (pre-M19-F1 fix) | Run 2 (post-M19-F1 fix) |
|---|---|---|
| PR | [#54](https://github.com/CTlanston/auto-evo-playground/pull/54) (closed) | [#55](https://github.com/CTlanston/auto-evo-playground/pull/55) |
| `secret_scan.status` | `BLOCKED` (false positive on `tokens`) | **`PASS`** (clean) |
| `diff_body_safe.md` | REDACTED summary | **Full unified diff** |
| Gemini verdict | NEEDS_HUMAN conf 0.1 | **PASS conf 1.0** |
| OpenAI verdict | mock NEEDS_HUMAN | mock NEEDS_HUMAN |
| Final state | WAITING_APPROVAL | WAITING_APPROVAL |
| Anthropic spend | **$0.00** | **$0.00** |

Auto-merge was correctly held in both runs by orthogonal gates
(M18-P1's mock-validator block + the `validator_disagreement` factor's
medium-risk promotion). Per directive: we did not set up an OpenAI key
for this milestone, so we explicitly **do not claim** a full
auto-merge proof. What we do claim is much stronger than the
pre-fix state: BR-001 produces a real diff body that a real top-shelf
validator can read and judge correctly, and BR-002 picks up the
operator's existing `GEMINI_API_KEY` from `~/.claude-code-247/.env`
without any shell-profile help.

## Test posture

```
$ .venv/bin/python -m pytest -q --no-cov
492 passed in 13.07s
```

- BR-001: 18 new tests (evidence_diff_body_safe + validator_receives_diff_body + secret_hit_blocks_diff_body_validator + 1 tweak to test_judge_contract)
- BR-002: 28 new tests (env_loader_precedence + env_loader_cwd_support + doctor_reports_config_source + launchd_plist_sets_config_env)
- BR-003: 25 new tests (worker_exit_record + worker_exit_classification + explain_stuck_uses_worker_exit + integration test_failed_worker_writes_exit_record)
- M19-F1: 2 new tests in test_secret_scanner.py (lowercase var not flagged + uppercase env var still caught)
- Total Δ: +73 tests on top of the 419 baseline at beta.0.

## Doctor

```
✓ config source: loaded /Users/lanston/.claude-code-247/config.yaml (kind=user); env files probed: 2
✓ auth mode: worker_mode=local_claude_code, usable=True
✓ sqlite db init: schema v3 at .../state/claude247.db
```

## What's intentionally still not in scope for beta

- Multi-machine HA — single-Mac is by design.
- Cross-org auth — local-first, one user, one machine.
- Docker runner outside dev mode — local backend covers stated scope.
- Dashboard auth — binds to `127.0.0.1` deliberately.
- Real-validator auto-merge demo with both Gemini + OpenAI — gated on
  the operator setting `OPENAI_API_KEY`; the system is ready for it.

## Pre-release

This is a **pre-release**. Production-ready (`v1.0.0`) is gated on a
clean full E2E with **both** real validators returning a real `PASS`
on a non-trivial diff. The plumbing is in place; the only missing
input is an OpenAI API key.
