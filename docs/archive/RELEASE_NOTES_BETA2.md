## v1.0.0-beta.2 — Pure auto-merge production proof

Eight-commit milestone (M20) on top of [v1.0.0-beta.1](https://github.com/CTlanston/claude-code-247/releases/tag/v1.0.0-beta.1). The headline: **the system landed a real PR on a real GitHub repo with both real validators returning PASS, no human approval, and $0 Anthropic worker spend** — the missing claim from beta.1.

See [M20_PRODUCTION_PROOF_REPORT.md](https://github.com/CTlanston/claude-code-247/blob/main/M20_PRODUCTION_PROOF_REPORT.md) for the full report.

## Headline

| Item | Value |
|---|---|
| Validator panel | **Gemini PASS conf 1.0** + **OpenAI PASS conf 1.0** (real, `gpt-4o`) |
| Risk | **0 (low)** |
| Merge ruling | **AUTO_MERGE** |
| PR | [auto-evo-playground#59 (MERGED)](https://github.com/CTlanston/auto-evo-playground/pull/59) |
| merge commit | `6c583d5e1b39f03f800591770fe2b715340f12a7` |
| Worker auth | `local_claude_code` (subscription) |
| Anthropic worker spend | **$0.00** |
| Total wall clock (enqueue → merged) | **3m 28s** |

## What got fixed (M20-P1b through M20-P3j)

The first M20-P3 E2E attempt didn't auto-merge. Five distinct evidence-pipeline gaps surfaced over the iteration series; each got a regression-tested fix.

| Fix | Commit | What it does |
|---|---|---|
| **M20-P1b** | `5aed874` | `env_loader.discover_env_paths()` probes `<user_config_dir>/secrets.env` (launchd-spawned daemons need this — no shell wrapper to source it). Also strips bash `export VAR=value` prefix. |
| **M20-P3b** | `1eb9d10` | `gateway/commands/dispatcher_cmd.py` calls `env_loader.load_chain(discover_env_paths(cwd=None))` instead of the legacy single-file `load()`. |
| **M20-P3d** | `1c18d49`-adjacent | Default OpenAI model `gpt-5` (org-gated) → `gpt-4o` (widely available, supports `response_format: json_object`). Operators can opt up via `config.validators.openai.model`. |
| **M20-P3g** | `1c18d49` | `EvidenceCollector` resolves base ref from `task_spec.default_branch` (with `origin/<branch>` and `HEAD` fallbacks) instead of always using `HEAD`. Necessary because Claude CLI commits its work mid-roleloop. |
| **M20-P3i** | `ef30853` | `snapshot_diff_body_safe` includes untracked files via `git ls-files --others`, synthesizing new-file diffs. Claude CLI often writes new files without staging. |
| **M20-P3j** | `cca1858` | `runner/role_loop.py` calls a new `_refresh_diff_evidence` helper after the coder and after each repair so the internal reviewer sees fresh state. Without this, the stale `review.md` was misleading the external OpenAI validator. |

## Operational additions

- **launchd daemon mode installed and verified** (4 services: dashboard
  KeepAlive + orchestrator / dispatcher / backup scheduled).
  Dashboard `/healthz` is live; all 4 plists now set `CLAUDE247_CONFIG`.
- **24h soak plan written** with baseline + health-check commands +
  failure conditions + stop/uninstall paths — see
  [M20_SOAK_PLAN.md](https://github.com/CTlanston/claude-code-247/blob/main/M20_SOAK_PLAN.md).

## Validated against CTlanston/auto-evo-playground

The clamp utility task ran end-to-end:

| Stage | Outcome |
|---|---|
| Worker (subscription claude CLI) | Wrote `clamp(value, min_value, max_value)` + 13 unit tests |
| Workspace pytest | 92 passed |
| BR-001 safe diff body | clean, real implementation visible, secret-scan PASS |
| BR-002 env chain | OPENAI_API_KEY + GEMINI_API_KEY loaded from secrets.env via the M20-P1b chain |
| BR-003 worker_exits | 3 rows, all `tests`/`success` |
| Gemini real verdict | PASS conf 1.0 |
| OpenAI real verdict (`gpt-4o`) | PASS conf 1.0 |
| Risk score | 0 (low) |
| Merge policy decision | `AUTO_MERGE` |
| Auto-merge wall-clock | 3 seconds (pr_created → merged) |

## Test posture

```
$ .venv/bin/python -m pytest -q --no-cov
502 passed in ~13s
```

- BR-001 / BR-002 / BR-003 / M19-F1 fix: as shipped in beta.1 (497)
- M20-P1b: +5 tests (secrets.env discovery, collision rules, missing-file
  graceful, ANTHROPIC-in-env doesn't flip mode, bash export strip)
- M20-P3g: +2 tests (committed agent-branch visible, default_branch fallback)
- M20-P3i: +3 tests (untracked new file in diff, forbidden untracked omitted,
  .evidence/ not listed)

## What's still pending

- The 24h soak observation itself — baseline is recorded, but the
  t+1h / t+6h / t+24h checkpoints in `M20_SOAK_PLAN.md` need an
  operator to run (or for the daemons to simply sit idle for 24h).
- Deeper `worker_exits` instrumentation outside `run_named_commands`.
- Qdrant live test (key not present in test env).

## Pre-release status

This is still a **pre-release**. With M20 done, the system has now
demonstrated a real end-to-end auto-merge with two real top-shelf
validators, real GitHub writes, real auth, $0 Anthropic worker spend,
and launchd 24/7 readiness. The remaining gap before a `v1.0.0` GA
tag is the observed soak window and any deeper instrumentation /
hardening you want before lifting the pre-release flag.
