# Human hold items

Tasks the supervisor cannot finish autonomously. Each item is a `HOLD-<n>`
entry. Resolve in any order; remove the entry once unblocked.

---

## HOLD-5: Inner engine auto-paused + parallel compose stack already running

- Severity: medium
- Category: safety
- Task affected: Phase 17 — `AUTODEV_LIVE=1 ./scripts/autodev_once.sh`
- What I tried:
  - Confirmed `HUMAN_CONFIG.md:runtime.live_allowed=true`
  - Fixed a Phase-15 defect where supervisor wasn't mirroring HUMAN_CONFIG → state (commit pending)
  - Investigated repo state before launch:
    - `state/PAUSED` set 2026-05-11 05:49 (no `PAUSED.human` companion — automatic, not human)
    - `state/orchestrator.db` shows active runs through 08:47 UTC (runs 70–74 on issue #10)
    - Live containers: `claude-code-247-orchestrator-1` (compose, up 3h) + `claude-reviewer-10-e79a33` (runner, up 2min)
- Why I could not continue safely:
  - The inner engine is already running in a parallel compose stack. Clearing `PAUSED` would let BOTH systems
    race against the same SQLite + GitHub state.
  - `PAUSED` was Guardian-set after a failure loop on issue #10 (3 reviewer rejections + 1 CI fail).
    Conditions that triggered it may not have resolved.
  - Per HUMAN_CONFIG.md hold policy + user constraint: "如果遇到 blocker, 记到 reports/human-hold.md 然后停下来等我"
- Exact human action needed: pick ONE of:
  - **(A) Hand off to my autodev supervisor**: `docker compose down`, then `rm state/PAUSED`, then re-run `AUTODEV_LIVE=1 ./scripts/autodev_once.sh`
  - **(B) Keep the compose stack as-is**: `rm state/PAUSED` and let the compose orchestrator pick up issue #10 — my autodev/supervisor stays in dry-run-only mode
  - **(C) Investigate first**: `sqlite3 state/orchestrator.db "SELECT detail FROM audit WHERE actor='guardian' ORDER BY id DESC LIMIT 1;"` — read why Guardian paused before deciding
- Workaround used: ran Phase 17 with PAUSED in place. The supervisor correctly detected the block:
  - Inner engine subprocess exit code 2 (PAUSED path in `main_oneshot.py`)
  - supervisor reported `blocked=True`, `blocker_reason="inner engine exit 2"`
  - state.json updated, reports written, no GitHub mutation, no quota burn
- Next safe task chosen: stop here, report to user.
- Timestamp: 2026-05-11T08:50:00Z

---

## HOLD-1: HUMAN_CONFIG.md missing

- Severity: low
- Category: product-decision
- Task affected: all live operations (cost mode, live_allowed, autostart_allowed defaults)
- What I tried: read `HUMAN_CONFIG.md` (not present)
- Why I could not continue safely: spec §5 says when `HUMAN_CONFIG.md` is missing,
  write `HUMAN_CONFIG.template.md`, open a hold, and proceed with safe defaults
- Exact human action needed: `cp HUMAN_CONFIG.template.md HUMAN_CONFIG.md`,
  review the defaults, change `cost.mode`, `runtime.live_allowed`,
  `runtime.autostart_allowed` if you want the supervisor to do real work
- Workaround used: supervisor uses the most conservative defaults
  (`cheap` cost mode, `live_allowed=false`, `autostart_allowed=false`)
- Next safe task chosen: continue implementation phases (Phase 1+)
- Timestamp: 2026-05-11

---

## HOLD-2: `tmux` not installed on host

- Severity: low
- Category: permission (install)
- Task affected: Phase 14 `scripts/start_tmux_autodev.sh` can be created but won't run
- What I tried: `which tmux` → not found
- Why I could not continue safely: installing tmux requires sudo/Homebrew —
  spec §2.3 says don't run risky commands
- Exact human action needed: `brew install tmux`
  (optional — only needed for tmux-based long-running supervisor)
- Workaround used: alternative supervisor invocations work via `nohup` and
  launchd; tmux script is created but skipped at runtime if tmux is absent
- Next safe task chosen: write the tmux script anyway, document the dependency
- Timestamp: 2026-05-11

---

## HOLD-4: Phase 17/18 — live single cycle + long-running supervisor

- Severity: low
- Category: product-decision
- Task affected: AutoDev v3 live operation (real shadow-branch work)
- What I tried: implementation, scaffolding, tests, dry-run — all green
- Why I could not continue safely: spec §17 / §18 say live cycle and the
  long-running supervisor run only after `HUMAN_CONFIG.md:runtime.live_allowed=true`.
  `HUMAN_CONFIG.md` is still missing (see HOLD-1) so the defaults force
  `live_allowed=false`.  Per the spec, when live/autostart aren't permitted,
  I must NOT start the infinite loop — instead write the exact commands to
  `reports/daily.md` and `docs/supervisor-operations.md` (already done).
- Exact human action needed (when you wake up):
  ```bash
  cp HUMAN_CONFIG.template.md HUMAN_CONFIG.md
  $EDITOR HUMAN_CONFIG.md      # flip runtime.live_allowed=true (and autostart_allowed=true if desired)
  ./scripts/autodev_doctor.sh
  ./scripts/autodev_once.sh --dry-run    # one more dry-run to confirm
  AUTODEV_LIVE=1 ./scripts/autodev_once.sh    # the first real cycle
  # If that one succeeds, start the long loop:
  ./scripts/start_tmux_autodev.sh
  ```
- Workaround used: stayed in dry-run mode; all scaffolding and reports are
  ready; the inner engine adapter is wired but won't be invoked until
  live_allowed flips
- Next safe task chosen: write `reports/final-autodev-v3-summary.md`, commit
- Timestamp: 2026-05-11

---

## HOLD-3: Claude Code CLI not on host PATH

- Severity: medium
- Category: permission (install)
- Task affected: `autodev/executors/claude_code_cli.py` host-direct execution path
- What I tried: `which claude` → not found
- Why I could not continue safely: the spec requires CLI-first execution;
  installing the npm package is fine, but we already have a working Docker
  image (`claude-code-247/runner:latest`) that includes the CLI v2.1.133
- Exact human action needed: `npm install -g @anthropic-ai/claude-code &&
  claude setup-token` (if you want host-direct CLI calls);
  OR set `AUTODEV_CLI_VIA_DOCKER=1` to keep using the existing container
- Workaround used: CLI executor falls back to the existing runner Docker image
  when host `claude` is absent
- Next safe task chosen: implement the executor with both code paths
- Timestamp: 2026-05-11
