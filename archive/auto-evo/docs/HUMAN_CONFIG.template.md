# HUMAN_CONFIG.md — copy this to HUMAN_CONFIG.md and fill in

The AutoDev v3 supervisor reads this file to know what it is and is not
allowed to do. **If `HUMAN_CONFIG.md` is missing the supervisor stays in the
safest defaults.** Copy this template to `HUMAN_CONFIG.md` and edit.

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
  anthropic_sdk_api_allowed: false                       # cheap mode MUST never call paid API
  daily_usd_cap: 0                                       # 0 = no spend allowed
  premium_guardian_allowed: false                        # set true only with explicit OK
```

## Live / autostart

```yaml
runtime:
  live_allowed: false                                    # set true to allow real commits / PRs
  autostart_allowed: false                               # set true to launch supervisor automatically
  interval_seconds: 900                                  # supervisor poll interval
  max_repair_attempts_per_task: 3
  max_review_rounds_per_task: 5
```

## Project commands (used by tests + doctor)

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
  slack_webhook_env: SLACK_WEBHOOK_URL                   # name of env var (already in .env)
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
  block_after_n_failures: 3                              # then hold task and move on
  critical_blockers_halt: true                           # halt only on critical (see prompt §5)
```
