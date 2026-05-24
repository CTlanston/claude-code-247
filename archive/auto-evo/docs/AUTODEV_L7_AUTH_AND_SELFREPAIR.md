# AutoDev L7 — Cycle Block: fix launchd auth + install hourly self-repair routine

> Hand this to Claude Code in /Users/lanston/projects/claude-code-247/.
> 5 cycles in sequence. After completion, the system runs hourly via launchd,
> diagnoses + self-heals when it can, and writes BLOCKED.md when it can't.

Read `AUTODEV_L7_MASTER_PROMPT.md` and the most recent
`reports/session-handoff-*.md`. Execute 5 cycles in sequence per §4
protocol. If any cycle fails, rollback to its `autoevo/pre-<id>` tag, write
the FAILURES entry, and CONTINUE to the next cycle (don't stop on early
failure — later cycles may still produce value).

═══════════════════════════════════════════════════════════════
CYCLE α — Tree cleanup (§4 step 1 unblocker)
═══════════════════════════════════════════════════════════════

Background: post-migration sed updates + operator helper docs left git tree
dirty. §4 step 1 requires clean tree. Cycle α just cleans up.

PLAN:
- Add `reports/runs/` to `.gitignore` (untracked operational output)
- Stage and commit the legitimate path-migration sed changes
  (AUTODEV_*.md, docs/adr/0000-*.md, reports/L7-session-wakeup-summary.md,
  reports/session-log.md, scripts/_emergency-diag.sh)
- Stage and commit operator-side docs that ended up untracked
  (AUTODEV_POST_L5_NEXT.md, migrate_out_of_desktop.sh, any other
  `*POST_L5*.md` or migration helpers in repo root)
- One atomic commit: `chore(migration): post-Desktop→projects/ cleanup + ignore reports/runs/`

VERIFY: `git status --porcelain` empty, `pytest -q` green, doctor 14/0/2.

═══════════════════════════════════════════════════════════════
CYCLE β — Fix launchd "Not logged in" (the primary blocker)
═══════════════════════════════════════════════════════════════

Background: Out-of-band manual patches to ~/Library/LaunchAgents/com.lanston.autodev.continuous.plist:
  1. PATH was extended to include `/Users/lanston/.npm/_npx/becf7b9e49303068/node_modules/.bin` (claude CLI lives there via npx cache)
  2. HOME=/Users/lanston was added to EnvironmentVariables

After both patches, `claude` is reachable BUT reports `Not logged in · Please run /login`. Root cause: macOS keychain ACL refuses launchd-spawned processes (they're not Terminal.app children). Claude's OAuth token is stored in keychain, inaccessible.

CORRECT FIX: route the OAuth token via the `CLAUDE_CODE_OAUTH_TOKEN` env var, bypassing keychain. The token is already in `.env` as `ANTHROPIC_API_KEY=sk-ant-oat01-...`. The existing `orchestrator/runner.py` has prefix-routing logic — reuse the pattern for the host-side wake script.

PLAN:
- Update `scripts/install_launchd_continuous.sh` to generate plist with:
  - PATH including the directory containing `claude` (auto-discovered at install time via `which claude || mdfind ...`)
  - HOME=/Users/lanston
  - All paths absolute (no $HOME literal in plist)
  - If discovered claude path is under `~/.npm/_npx/`, print a clear warning at install time recommending `npm install -g @anthropic-ai/claude-code` for stability
- Update `scripts/autodev_continuous_cycle.sh` to source OAuth token from `.env` and route by prefix (CRITICAL: only read the specific variable, don't `eval` arbitrary .env content):

```bash
# In autodev_continuous_cycle.sh, near top (BEFORE invoking claude):
if [[ -f "$REPO/.env" ]]; then
  raw_token=$(grep '^ANTHROPIC_API_KEY=' "$REPO/.env" | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [[ "$raw_token" == sk-ant-oat01-* ]]; then
    export CLAUDE_CODE_OAUTH_TOKEN="$raw_token"
    unset ANTHROPIC_API_KEY 2>/dev/null
  elif [[ "$raw_token" == sk-ant-api03-* ]]; then
    export ANTHROPIC_API_KEY="$raw_token"
  fi
fi
```

- Add tests/test_install_launchd_continuous.py regression tests:
  - test_plist_has_HOME_env (HOME=/Users/lanston)
  - test_plist_path_contains_claude_dir
  - test_no_unexpanded_home_variable
  - test_plist_xml_valid (plutil -lint)
- Add tests/test_autodev_continuous_cycle.py regression tests:
  - test_oauth_token_routed_to_correct_env_var (mocks .env with sk-ant-oat01-... prefix, asserts CLAUDE_CODE_OAUTH_TOKEN is set)
  - test_api_key_routed_correctly (with sk-ant-api03-... prefix, asserts ANTHROPIC_API_KEY is set)
  - test_no_env_file_falls_back_to_environment (uses pre-existing env vars)
- Write `docs/adr/0010-launchd-auth-via-env-var.md`:
  - Context: macOS keychain ACL blocks launchd-spawned processes
  - Decision: route OAuth/API token via env var by reading specific .env line
  - Consequences: .env stays the single source of truth; rotation = edit one file
  - Alternatives rejected: keychain ACL patching (fragile); credential file in ~/.claude (assumed but unverified)
  - Linked regression tests

ACCEPTANCE:
1. Reinstall plist via `bash scripts/install_launchd_continuous.sh --install`
2. Unload + load: `launchctl unload -w ~/Library/LaunchAgents/com.lanston.autodev.continuous.plist && launchctl load -w ...`
3. Force wake: `launchctl kickstart -k gui/$(id -u)/com.lanston.autodev.continuous`
4. Wait 120 seconds (longer than 90 — gives claude time to actually start a cycle)
5. Newest log in `reports/runs/2026*.log` must be > 1 KB AND NOT contain "Not logged in"
6. Ideal: it shows real cycle work (Planner/Coder output, git operations)

If step 5 fails, rollback Cycle β and write FAILURES entry naming the new error (not "Not logged in"). The fact that token routing works at all is verified by the unit tests — actual launchd integration may still need follow-up.

═══════════════════════════════════════════════════════════════
CYCLE γ — Codify out-of-band plist patches (system hygiene)
═══════════════════════════════════════════════════════════════

Background: The PATH + HOME plist edits were done manually (PlistBuddy / Cursor) BEFORE Cycle β. The install script doesn't reproduce them. Anyone reinstalling launchd today would lose them. Cycle β's install script update should handle this — but verify and add tests.

PLAN:
- Audit `scripts/install_launchd_continuous.sh` after Cycle β. Verify:
  - It writes a plist semantically identical to the manually-patched live plist
  - `plutil -lint` of generated plist passes
  - All paths absolute, no env-var literals
- If discrepancy exists, fix the install script (NOT the live plist)
- Add an idempotence test: running install_launchd_continuous.sh --install twice produces identical plists
- Add a self-test target `bash scripts/install_launchd_continuous.sh --dry-run` that prints the plist without writing
- ADR-0011: idempotent launchd install + path discovery

ACCEPTANCE: 
- `bash scripts/install_launchd_continuous.sh --dry-run` produces valid plist XML
- Re-running --install produces identical plist (`diff $(cat /tmp/plist1) $(cat /tmp/plist2)` empty)
- All new regression tests green

═══════════════════════════════════════════════════════════════
CYCLE δ — Self-repair routine (operator-requested durability)
═══════════════════════════════════════════════════════════════

Background: When a cycle fails repeatedly (3+ consecutive failures with identical error signature), the system should auto-trigger a diagnostic cycle that either fixes the issue OR writes a concrete BLOCKED.md.

PLAN:
- Extend `scripts/autodev_continuous_cycle.sh` with failure-tracking:
  - On each wake, after `claude -p` returns, hash the last 10 lines of stdout/stderr → store in `reports/runs/.failure-signature.last`
  - If 3 consecutive wakes have same signature AND non-zero exit → enter SELF-REPAIR mode
- In SELF-REPAIR mode, instead of normal cycle, spawn `claude -p` with a special prompt:

```
You are in self-repair mode. The launchd-driven cycle has failed 3 times consecutively. Analyze the failure logs:
  - tail -100 of reports/runs/launchd.log
  - last 3 reports/runs/2026*.log files
  - reports/runs/.failure-signature.last
  
Identify the root cause from KNOWN failure patterns:
  1. "Not logged in" → re-source .env, check CLAUDE_CODE_OAUTH_TOKEN env var
  2. "command not found" → check PATH in plist
  3. "Operation not permitted" → TCC restriction; recommend Full Disk Access for /bin/bash
  4. "rate limit" / "429" → write reports/quota-rate-limit-until.ts with backoff
  5. "git status not clean" → suggest operator run cleanup; do NOT auto-clean
  6. Anything else → write BLOCKED.md with the failure signature + log excerpt + recommendation
  
For known patterns 1-4: attempt the documented fix, then trigger a kickstart to verify. If verified, clear the failure-signature file. Log the action to reports/self-repair.log.

For pattern 5 or unknown: do NOT attempt auto-fix. Write BLOCKED.md with: error signature, log excerpt, 3 plausible operator actions. Exit.

Hard constraints: §0 in full. Do not modify code outside scripts/autodev_continuous_cycle.sh and the plist. Do not push, merge, or touch secrets. 15-min wall budget for self-repair.
```

- Add a new script `scripts/autodev_self_repair.sh` that the wake script invokes when in SELF-REPAIR mode (separates concerns from the normal cycle path)
- Add tests/test_self_repair.py:
  - test_failure_signature_persists_across_wakes
  - test_three_consecutive_same_signature_triggers_repair
  - test_one_off_failure_does_not_trigger_repair
  - test_signature_resets_after_successful_cycle
- ADR-0012: self-repair routine

ACCEPTANCE:
- Simulate 3 consecutive failures (manually inject 3 identical error logs) → assert next wake triggers self_repair.sh
- Simulate intermittent failures (different signatures) → no trigger
- Run the actual self-repair script with a known-pattern log → verify it logs to reports/self-repair.log

═══════════════════════════════════════════════════════════════
CYCLE ε — Hourly cadence option + completion celebration
═══════════════════════════════════════════════════════════════

Background: Operator may prefer 1-hour cadence over 15-min (lower load, less log churn). System should support this. Also: when Overall L=5 is achieved AND maintained for 5 consecutive cycles, write a "celebration" AUTODEV_DONE.md with final summary.

PLAN:
- Add `HUMAN_CONFIG.runtime.launchd_interval_seconds` (default 900 = 15 min, document 3600 = 1 hour as recommended for steady state)
- Update `scripts/install_launchd_continuous.sh` to read this value when generating plist
- Add stability counter: `reports/level5-stability.txt` tracks consecutive cycles where Overall L stayed >= AUTODEV_TARGET_L
- When stability hits 5 (configurable), wake script writes a comprehensive `reports/AUTODEV_DONE.md`:
  - Final Overall L
  - Per-dim levels
  - Total cycles executed since Bootstrap
  - Total wall time
  - Total commits
  - C streak high-water mark
  - Codex token spend (sum from reports/codex-spend.jsonl)
  - Honest assessment of "what this system can do now"
- After AUTODEV_DONE.md is written, launchd keeps waking (every interval) but exits 0 immediately on detecting DONE. No further work.
- Operator can resume work by raising AUTODEV_TARGET_L and removing AUTODEV_DONE.md.

PLAN sub-acceptance:
- HUMAN_CONFIG changes documented in ADR-0013
- Generated plist for interval=3600 has `<integer>3600</integer>` for StartInterval
- Stability counter increments on each cycle with Overall L >= TARGET
- Stability counter resets if Overall L drops
- AUTODEV_DONE.md content schema validated by tests

ACCEPTANCE:
- All new tests green
- Doctor still 14/0/2
- compute_level --check exits 0
- Manual: flip HUMAN_CONFIG.runtime.launchd_interval_seconds to 3600, reinstall plist, verify plist XML shows 3600.

═══════════════════════════════════════════════════════════════

When all 5 cycles complete: write `reports/session-handoff-<ts>.md` summarizing what landed.

OPERATOR'S POST-SESSION ACTIONS (only 2 commands required):

1. Reinstall launchd to pick up generated changes:
   ```bash
   launchctl unload -w ~/Library/LaunchAgents/com.lanston.autodev.continuous.plist
   bash scripts/install_launchd_continuous.sh --install
   ```

2. Force one immediate wake to verify auth fix works under launchd:
   ```bash
   launchctl kickstart -k gui/$(id -u)/com.lanston.autodev.continuous
   sleep 120
   tail -50 $(ls -t reports/runs/2026*.log | head -1)
   ```
   
   Must show real cycle work (not "Not logged in"). If it does → system is now hourly-self-repairing, and will run autonomously until Overall L=5 stable for 5 cycles, then write AUTODEV_DONE.md and gracefully stop.

═══════════════════════════════════════════════════════════════

HARD CONSTRAINTS THROUGHOUT (re-stated):
- §0 from AUTODEV_L7_MASTER_PROMPT.md in full
- §13 termination checklist before every cycle exit
- §16 tone & discipline
- ADR-0008 codex budget guard
- 45-min wall-clock per cycle (use `gtimeout` if available, otherwise rely on
  natural session boundaries — DO NOT install coreutils via brew in this cycle;
  separate FAIL-0012 entry if you want to track it)
- Atomic commits on autoevo/<cycle-id>/<slug> branches
- NO git push, NO PR merge, NO `.env` reads except for the OAuth token specific line in Cycle β
- LEVEL.md never hand-edited

ROLLBACK SAFETY:
Every cycle starts with `git tag autoevo/pre-<cycle-id>`. Failure of any
cycle: `git reset --hard <tag>`, FAILURES entry, CONTINUE to next cycle
(don't bail on the whole session).

CONTEXT BUDGET:
This is a 5-cycle session. Realistic 2-3 hours of Claude Code work. If
context approaches 80% full before all 5 land, write reports/session-handoff-
<ts>.md and exit. The unfinished cycles become the next session's first work.

═══════════════════════════════════════════════════════════════

Begin Cycle α NOW. Don't narrate the directive back. Just orient,
plan, execute, verify, record, exit. Proceed through cycles in order.
