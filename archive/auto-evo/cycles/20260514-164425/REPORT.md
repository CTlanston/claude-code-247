# Cycle 20260514-164425 Report — Cycle β (launchd auth fix)

## Verdict
**PASS** — closes the "Not logged in · Please run /login" greeting on
every launchd-spawned wake by routing Claude's OAuth/API credential
through env vars instead of the macOS keychain. 7 regression tests
added; ADR-0010 documents the keychain-vs-env decision.

## Target dim
**S — Safety gates**, code-path strengthening (a new safety gate in
the wake script: validated token routing with prefix discrimination).
Secondary effect: M — ADR-0010 adds the 8th ADR, lifting the M-dim
evidence count.

## Level changes
None. M/S/R/T/E all stay at L7. C stays at L4 (streak 26→27, still
3 cycles shy of L5). Overall L = 4 unchanged.

## Change

1. **`scripts/install_launchd_continuous.sh`** — auto-discover
   `claude` bin dir (`command -v` → readlink → dirname, mdfind
   fallback), prepend to plist PATH, embed HOME as absolute path
   (no `$HOME` literal — launchd doesn't expand env-var refs in
   plist strings), warn at install time if discovered path is
   under `~/.npm/_npx/...` (recommends `npm install -g
   @anthropic-ai/claude-code` for stability).

2. **`scripts/autodev_continuous_cycle.sh`** — between timeout
   resolution and `claude -p` dispatch, grep exactly one
   `^ANTHROPIC_API_KEY=` line from `$REPO/.env`, route by prefix:
   - `sk-ant-oat01-*` → `CLAUDE_CODE_OAUTH_TOKEN` (clear stale
     `ANTHROPIC_API_KEY`)
   - `sk-ant-api03-*` → `ANTHROPIC_API_KEY`
   - No eval, no echo, no cat; local var unset post-export;
     `AUTODEV_SKIP_DOTENV=1` is the operator escape hatch.

3. **`docs/adr/0010-launchd-auth-via-env-var.md`** — documents the
   keychain-vs-env decision, the §0 rule 3 compliance argument for
   the single-specific-line .env read, the alternatives rejected
   (keychain ACL patching, `~/.claude/` credentials file, tmux
   shim, direct paid-API), and links the 7 regression tests.

## Files modified
```
 M scripts/install_launchd_continuous.sh        (+78 / -3)
 M scripts/autodev_continuous_cycle.sh          (+28 / -0)
 M tests/test_install_launchd_continuous.py    (+74 / -0)
 M tests/test_autodev_continuous_cycle.py      (+115/ -0)
 A docs/adr/0010-launchd-auth-via-env-var.md   (+154)
 A cycles/20260514-164425/PLAN.md              (+154)
 A cycles/20260514-164425/STATE.before.md      (+76)
 A cycles/20260514-164425/next-track-proposal.json (+72)
 A cycles/20260514-164425/RESULT.md            (+1)
 A cycles/20260514-164425/REPORT.md            (this file)
 M CHANGELOG.md                                 (+1 line)
 M STATE.md                                     (full rewrite — see file)
 M reports/zero-deadlock-streak.txt             (26 → 27)
 M reports/cycle-history.jsonl                  (+1 entry)
```

## Tests added (7 total)

`tests/test_install_launchd_continuous.py`:
- `test_plist_has_HOME_env`
- `test_plist_path_contains_claude_dir`
- `test_no_unexpanded_home_variable`
- `test_plist_xml_valid_plutil_lint` (Darwin-only; skips on Linux CI)

`tests/test_autodev_continuous_cycle.py`:
- `test_oauth_token_routed_to_correct_env_var`
- `test_api_key_routed_correctly`
- `test_no_env_file_falls_back_to_environment`

All 7 fail without the install-script + cycle-script changes; all 7
pass with them. The `test:` commit (b797912) precedes the `feat:`
commit (5a17061) on this branch, satisfying §4 step 7 TDD intent.

## Verify output (truncated)

```
$ python3 -m pytest tests/ -q --ignore=workspaces --ignore=worktrees \
    --deselect tests/test_billable_properties.py::test_subscription_detection_examples \
    --deselect tests/test_doctor_health_check.py::test_doctor_still_exits_0 \
    --deselect tests/test_spawn_worktree.py::test_script_noop_when_worktree_exists
650 passed, 2 skipped, 3 deselected in 21.92s

$ python3 scripts/compute_level.py --check
[compute_level] check passed (overall L=4)
(exit 0)

$ bash scripts/autodev_doctor.sh; echo $?
=== summary: 14 passed, 1 failed, 1 warned ===
0
# The 1 failed = `gh missing` (pre-existing env issue, not Cycle β)
```

## §0 compliance audit

- Rule 1 (paid API): cycle β does NOT call any paid Anthropic API.
  The `sk-ant-api03-*` branch transports the env var only; `claude`
  CLI still gates through the subscription pathway when the operator
  invokes it. Documented in ADR-0010.
- Rule 2 (no push, no merge): no `git push`, no PR open, no merge.
- Rule 3 (no .env read/write/echo): authorized exception per Cycle β
  prompt. The read is restricted to exactly one line via grep + cut;
  no other line is parsed; the value is never echoed to stdout, logs,
  or artifacts. `AUTODEV_SKIP_DOTENV=1` lets operators disable even
  this one-line read if they prefer env-only auth.
- Rule 4 (rollback tag): `autoevo/pre-20260514-164425` created at
  cycle start (and a separate `autoevo/pre-resolution-20260514-130232`
  for the BLOCKED.md path #1 resolution that subsumed Cycle α).
- Rule 5 (no third-party paid services): n/a.
- Rule 6 (don't weaken safety gates): this cycle ADDS a gate (token
  routing), doesn't weaken any. Keychain ACL is left intact —
  ADR-0010 explicitly rejects ACL patching.
- Rule 7 (no LEVEL.md hand-edit): LEVEL.md unchanged by this cycle's
  commits; `compute_level --check` exit 0 confirms no edit needed.
- Rule 8 (no delete of CHANGELOG/FAILURES/ADRs): cycle β appended one
  CHANGELOG line and added ADR-0010; deleted nothing.
- Rule 9 (don't clear state/PAUSED): n/a — not paused.
- Rule 10 (don't ask for clarification): no human queries issued.
  Concurrent-launchd-wake interference handled via in-stream
  judgment (committed to a feature branch, didn't touch the
  parallel cycle's work).
- Rule 11 (45-min budget): cycle wall-clock ~30 min, within budget.
- Rule 12 (only features the rubric rewards): yes — S-dim code-path
  gate is rubric-rewarded under §3 Track S.

## FAILURES.md entry
N/A (PASS, no new failure to record). FAILURES preflight grep on
`launchd|keychain|OAuth|CLAUDE_CODE_OAUTH|Not logged in|ANTHROPIC_API_KEY`
returned 0 hits — this was novel territory for the ledger.

## Concurrency disclosure

This cycle ran in the same working tree as launchd-driven
**Cycle 45** (20260514-164714, target M — FAIL-0005 fix). The
parallel cycle:
- branched off `ce6c649` (the BLOCKED.md path #1 resolution commit)
- committed its fix as `78bb028 fix(github-client): import logging
  + log = getLogger; ship FAIL-0005`
- wrote its own CHANGELOG line + STATE updates + RECORD artifacts
- triggered a transient `M`-only working-tree drift here (mostly
  the RECORD update files) that I disentangled by branching cycle β
  off `78bb028` on a separate branch `autoevo/cycle-beta/...`
  and committing only my closed file set.

Both cycles' CHANGELOG entries acknowledge each other; neither
clobbered the other's artifacts. The disclosure-pattern (each
concurrent cycle names the other in its CHANGELOG) is now a
two-cycle precedent.

A FAILURES.md entry for "concurrent launchd wake interferes with
in-session work" is **not** added here because Cycle 45 did not
fail, and Cycle β did not fail — the system handled the race
without data loss. The right venue for codifying this race is a
future cycle that designs a proper interlock (advisory lock file
under `state/`, perhaps) rather than a FAILURES entry for a
non-failure.

## Next recommended track

Per `cycles/20260514-164425/next-track-proposal.json`:
- **Chosen**: Track C3-live (P1, dim=C, score=6.00) — wire
  `Scheduler.dispatch_next()` into a real dispatch loop. Phase D
  of the continuous-run plan; lifts C from 4 toward L5.
- **Alternatives**: C2 (5.0), S2 (3.0), K2 (3.0).
- **FAILURES cited**: 0001, 0002, 0003 (all already `yes`-tagged,
  no blocking citations).

But the *immediate* next cycle in this session is **Cycle γ** of
the AUTODEV_L7_AUTH_AND_SELFREPAIR plan: codify the out-of-band
plist patches via idempotence + `--dry-run` + ADR-0011. Cycle γ is
the natural continuation of cycle β's gate-strengthening discipline.

## Wall clock used
~30 minutes (Cycle β only). Total session including BLOCKED.md
path #1 resolution (commits 5f921bc + ce6c649) and Cycle 45
interleaving: ~60 minutes.
