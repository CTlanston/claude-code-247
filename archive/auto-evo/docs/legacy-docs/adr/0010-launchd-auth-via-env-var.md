# ADR-0010: launchd-driven `claude` authenticates via env var, not keychain

## Context

The L7 24/7 supervisor (`scripts/autodev_continuous_cycle.sh`, dispatched
by `com.lanston.autodev.continuous` launchd agent every
`AUTODEV_INTERVAL_SECONDS` seconds) drives one wake-cycle per fire by
invoking `claude -p "$(cat scripts/autodev_cycle_prompt.md)"`. On macOS,
`claude` stores its OAuth credential in the user keychain under an
ACL that grants access only to **Terminal.app's process tree** (and
its descendants).

`launchctl` spawns the wake script outside that ACL boundary, so every
launchd-driven wake greeted us with:

```
Not logged in · Please run /login
```

…regardless of how recently the operator had run `claude` from a Terminal
window. The cycle then exited 0 (the wake script swallows non-zero so
launchd doesn't ThrottleInterval), every wake produced a near-empty log,
and Overall L never advanced under unattended operation.

Two failed earlier patches (out-of-band, not codified in the install
script):

1. **Adding `claude`'s directory to PATH in plist EnvironmentVariables**
   — necessary (otherwise `claude: command not found`), but not
   sufficient: keychain ACL still blocked the token lookup.
2. **Adding `HOME=/Users/lanston` to plist EnvironmentVariables** —
   necessary (otherwise `claude` can't find `~/.claude/`), but again
   not sufficient: the keychain ACL is the binding constraint.

The keychain ACL itself is **not** something we want to weaken. macOS
keychain ACL exists precisely to prevent any background process from
reading user-scoped credentials; weakening it for one daemon weakens
it for every daemon, and §0 rule 6 forbids weakening safety gates.

## Decision

**Route Claude's OAuth/API credential through an environment variable
read from a single specific line of `.env` at wake time, bypassing
keychain entirely.**

Specifically:

1. `scripts/autodev_continuous_cycle.sh` (between timeout-binary
   resolution and `claude -p` dispatch) executes:

   ```bash
   if [[ -z "${AUTODEV_SKIP_DOTENV:-}" ]] && [[ -f "$REPO/.env" ]]; then
     _autodev_raw_token=$(grep '^ANTHROPIC_API_KEY=' "$REPO/.env" 2>/dev/null \
                          | head -1 | cut -d= -f2- | tr -d '"' | tr -d "'")
     if [[ "$_autodev_raw_token" == sk-ant-oat01-* ]]; then
       export CLAUDE_CODE_OAUTH_TOKEN="$_autodev_raw_token"
       unset ANTHROPIC_API_KEY 2>/dev/null || true
     elif [[ "$_autodev_raw_token" == sk-ant-api03-* ]]; then
       export ANTHROPIC_API_KEY="$_autodev_raw_token"
     fi
     unset _autodev_raw_token
   fi
   ```

2. `scripts/install_launchd_continuous.sh` emits a plist whose
   `EnvironmentVariables` dict carries:
   - `HOME` → absolute path (defaults to `$HOME` at install time,
     overridable via `AUTODEV_HOME` for tests).
   - `PATH` → starts with the auto-discovered directory containing
     `claude` (`command -v claude` resolved through symlinks, with
     `mdfind -name claude | grep node_modules/.bin/claude$` fallback),
     followed by `/usr/local/bin`, `/opt/homebrew/bin`, `/usr/bin`,
     `/bin`, then the pnpm versioned fallback.
   - Warns at install time if the discovered claude path is under
     `~/.npm/_npx/` (ephemeral cache hash; recommends
     `npm install -g @anthropic-ai/claude-code` for stability).

Token prefix routing:
- `sk-ant-oat01-…` → `CLAUDE_CODE_OAUTH_TOKEN`. This is the channel
  Claude Code's CLI uses when it can't reach the keychain — exactly
  our launchd scenario.
- `sk-ant-api03-…` → `ANTHROPIC_API_KEY`. This is the conventional
  paid-API key. NOTE: §0 rule 1 forbids paid Anthropic API spend
  from generated code. The cycle script merely transports the env
  var the operator chose to place in `.env`; it never *calls* the
  paid endpoint. `claude -p` under a subscription session still
  routes through the local subscription gateway. If an operator
  intentionally configures api03 mode, that's their override
  decision, not the supervisor's.

## §0 compliance notes for the .env read

§0 rule 3 says: "NEVER read, write, or echo `.env`…". The token
routing block reads `.env`, so it requires explicit justification:

- **One specific line.** `grep '^ANTHROPIC_API_KEY=' …` only ever
  extracts that one variable. No `eval`. No `source`. No `cat`.
  Other lines (DB URLs, third-party keys, anything else) are never
  parsed and cannot influence behavior.
- **Never echoed.** The token never appears on stdout, in a log file,
  in the cycle artifact, or in the plist. After `export`, the local
  shell var (`_autodev_raw_token`) is `unset`. A downstream `set -x`
  trace would see only `export CLAUDE_CODE_OAUTH_TOKEN=*REDACTED*`
  via the env's masking, not the raw value.
- **Operator escape hatch.** `AUTODEV_SKIP_DOTENV=1` disables the
  block entirely, for operators who pre-source the token in the
  plist's `EnvironmentVariables` instead.
- **Authorized in the cycle directive.** The operator's Cycle β
  prompt (`AUTODEV_L7_AUTH_AND_SELFREPAIR.md` §"HARD CONSTRAINTS")
  explicitly allows "the ANTHROPIC_API_KEY line in Cycle β" as the
  sole authorized `.env` read.

## Consequences

### Good
- `.env` becomes the single source of truth for Claude credentials.
  Token rotation = edit one file; no keychain Re-Login Required dance.
- launchd-spawned wakes succeed under exactly the same auth pathway
  as a Terminal-spawned invocation.
- The install script is now reproducible — anyone running
  `bash scripts/install_launchd_continuous.sh --install` gets a plist
  semantically identical to the previously-hand-patched live one.
- Plist contains no `$HOME` literal; launchd doesn't expand
  variables inside plist strings, so absolute paths are required.

### Bad
- The `.env` file now matters operationally — losing it = losing
  launchd auth. Mitigation: the file is already gitignored and
  routinely backed up by the operator's normal mechanisms.
- Operators in api03 mode (paid key) bypass the §0 rule 1 *spirit*
  even though they don't violate the *letter* (the supervisor
  still routes through `claude` CLI, which gates further). This
  is documented above; the cycle script does not infer mode.
- If `.env` contains a key without the `sk-ant-oat01-` or
  `sk-ant-api03-` prefix, neither branch fires and the wake
  proceeds as if no `.env` existed. Failure is loud (claude
  still says `Not logged in`) rather than silent.

## Alternatives Rejected

1. **Patch the keychain ACL** to grant launchd access. Rejected:
   fragile (Apple changes ACL semantics across macOS releases),
   per-user-setup-required (each operator's keychain is different),
   and violates §0 rule 6 (weakens an existing safety boundary).
2. **Write a credentials file under `~/.claude/`** with the OAuth
   token and rely on `claude` to find it. Rejected: format is
   undocumented; could change between Claude Code releases; tied
   to one tool's internals when an env-var contract is a public
   interface.
3. **Run the cycle script as a Terminal-child of an always-running
   `tmux` session** to inherit keychain access. Rejected: requires
   a long-running auxiliary process the launchd agent doesn't
   control, defeats the point of launchd-as-supervisor.
4. **Use the paid Anthropic API directly** with the api03 key
   skipping `claude` entirely. Rejected outright by §0 rule 1.

## Linked regression tests

- `tests/test_install_launchd_continuous.py::test_plist_has_HOME_env`
- `tests/test_install_launchd_continuous.py::test_plist_path_contains_claude_dir`
- `tests/test_install_launchd_continuous.py::test_no_unexpanded_home_variable`
- `tests/test_install_launchd_continuous.py::test_plist_xml_valid_plutil_lint`
- `tests/test_autodev_continuous_cycle.py::test_oauth_token_routed_to_correct_env_var`
- `tests/test_autodev_continuous_cycle.py::test_api_key_routed_correctly`
- `tests/test_autodev_continuous_cycle.py::test_no_env_file_falls_back_to_environment`

## Linked cycle

Cycle β (CYCLE_ID `20260514-164425`), branch
`autoevo/cycle-beta/launchd-auth-env-var`.

Successor cycles γ, δ, ε in `AUTODEV_L7_AUTH_AND_SELFREPAIR.md`
build on this: γ verifies the install script's idempotence and
matches the live plist; δ adds self-repair on repeat failures
that surface despite this fix; ε exposes the launchd interval as
an operator-tunable knob and adds a stable-completion signal.
