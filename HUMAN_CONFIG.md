# HUMAN_CONFIG.md

Authoritative policy file for the AutoDev v3 supervisor. **Edit this file to
change behaviour — don't touch code.** When this file is missing, the
supervisor falls back to its safest defaults.

> Filled in by Cowork on 2026-05-11 based on Lanston's stated preferences
> (cheap mode, no API spend, no auto-merge). Live mode is ON because the
> Phase-15/16 dry-run passed cleanly; flip `runtime.live_allowed` back to
> `false` any time you want to re-quarantine the supervisor.

## Repository

```yaml
repo:
  default_branch: main                                   # never push here
  shadow_branch_prefix: shadow                           # agent pushes to shadow/<task-id>
  github_repo: CTlanston/auto-evo-playground             # the test repo, not this one
  forbid_push_to_main: true
  forbid_force_push_to_main: true
```

## Cost policy

```yaml
cost:
  mode: cheap                                            # cheap | balanced | premium
  anthropic_sdk_api_allowed: false                       # do NOT call the paid API
  daily_usd_cap: 0                                       # 0 = no per-token spend allowed
  premium_guardian_allowed: false                        # require human OK before flipping
```

## Live / autostart

```yaml
runtime:
  live_allowed: true                                     # dry-run passed 2026-05-11; live cycle OK
  autostart_allowed: false                               # do NOT auto-launch supervisor — start it manually
  interval_seconds: 900                                  # 15-min cadence when supervisor IS running
  max_repair_attempts_per_task: 3
  max_review_rounds_per_task: 5
  # --- Codex CLI cross-model review (added Cycle 15; see ADR-0008) ---
  codex_enabled: true                                    # operator installed + OAuth-authenticated 2026-05-12
  codex_daily_cap_tokens: 200000                         # ≈ $1/day at gpt-5.4 input rates
  codex_per_call_cap_tokens: 60000                       # anomaly threshold (log + alert)
  codex_fallback_on_refusal: true                        # fall back to single-Claude review when guard refuses
  codex_binary: codex                                    # PATH-resolved; budget guard wraps every call
  # --- Track T6 live sanity (Cycle 22) ---
  live_sanity_authorized: false                          # AUTODEV_LIVE=1 requires THIS to be true; default dry-run only
```

## Project commands

```yaml
commands:
  install:    "python3 -m pip install -r orchestrator/requirements.txt"
  test:       "python3 -m pytest -q"
  lint:       "python3 -m ruff check ."
  format:     "python3 -m ruff format --check ."
  doctor:     "./scripts/autodev_doctor.sh"
```

## Notifications

```yaml
notifications:
  slack_webhook_env: SLACK_WEBHOOK_URL                   # env var (already set in .env)
  notify_on:
    - blocker
    - rate_limit
    - guardian_pause
    - daily_report
```

## Hold / escalation policy

```yaml
hold:
  human_hold_file: reports/human-hold.md
  block_after_n_failures: 3                              # park task and move on
  critical_blockers_halt: true                           # halt only on critical issues
```

## Hard rules (do not let any agent override these)

- Never push to `main` directly.
- Never auto-merge a PR. Human is the only merge approver.
- Never call Anthropic SDK / API while `cost.mode == cheap`.
- Never modify `.env`, secrets, keychains, or SSH keys.
- Never deploy to production or run destructive operations on external services.
- If blocked, append to `reports/human-hold.md` and continue with the next safe task.
