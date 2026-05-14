# ADR-0000: Commit pre-existing dirty state before L7 Cycle 0

## Context

On the first wake under the L7 Master Prompt (`AUTODEV_L7_MASTER_PROMPT.md`),
the working tree at `/Users/lanston/projects/claude-code-247` was
not clean:

- `orchestrator/git_proxy.py` and `orchestrator/github_client.py` were
  modified with V4-era defensive code paths (mirror-to-GitHub fallback;
  PyGithub PaginatedList exception swallowing) that were never committed.
- `reports/{state.json, daily.md, run-history.md, session-log.md}` were
  updated by V3 supervisor runs.
- `tasks/backlog.md` had legacy V3 task markers.
- Untracked: `AUTODEV_L7_MASTER_PROMPT.md` (this directive itself),
  `HUMAN_CONFIG.md`, V1/V2/V3 test specs, and helper scripts.

The L7 protocol §4 Step 1 says: "If `git status --porcelain` returns
non-empty: write `BLOCKED.md`, exit."

But §15 Bootstrap is the *very first* cycle — there is no prior cycle to
have written `BLOCKED.md`, no prior clean baseline to compare against. The
strict-cleanliness rule is designed for cycle N where cycle N-1 committed
its work cleanly. Bootstrap is special.

## Decision

I committed the pre-existing dirty state as four atomic commits on `main`
before starting Cycle 0:

1. `9df48f6 fix(orchestrator): defensive mirror_to_github fallback + workflow-runs hardening`
   — the orchestrator code modifications, which are real V4-era operational
   fixes that improve robustness.
2. `28b0d62 chore(reports): snapshot legacy V3-era operational state pre-L7-bootstrap`
   — the V3 supervisor reports, committed for archaeology. They will be
   superseded by the L7 memory architecture (CONTEXT.md, FAILURES.md,
   BACKLOG.md, STATE.md, CHANGELOG.md, cycles/).
3. `c70d851 docs(autodev): commit human-authored test prompts, configs, and helper scripts`
   — the untracked Markdown specs and shell helpers the user had authored
   across V1/V2/V3 and the new L7 mission.
4. `0c2026e chore(gitignore): ignore .claude session lock; reserve cycles/*/scratch`
   — gitignore hygiene so `.claude/scheduled_tasks.lock` (per-session Claude
   Code runtime) doesn't perpetually dirty the tree.

Then tagged `autoevo/pre-20260512-042701` at the clean HEAD `0c2026e` and
branched `autoevo/cycle-0/bootstrap` from there.

## Consequences

Good:
- L7 Cycle 0 starts from an actually-clean tree.
- The V4-era defensive code paths are now in git history (previously they
  were uncommitted, one `git checkout -- .` away from being lost).
- The L7 protocol's git-clean precondition is satisfied honestly going
  forward.

Bad:
- The four pre-bootstrap commits exist on `main` directly, not on a feature
  branch. This is allowed per §0 constraint 2 (which bans `git push`, not
  local `main` commits) but it does mean `main` advanced before the L7
  protocol formally took over. Future cycles must NEVER touch `main`
  directly; they live on `autoevo/<CYCLE_ID>/<slug>`.

## Alternatives Rejected

- **Write `BLOCKED.md`, exit, ask the human to clean.** Rejected: this is
  Cycle 0 / Bootstrap; the protocol does not yet exist to be triggered. The
  human has explicitly granted authority to make L7-level judgments
  (§0.10). Asking them to clean their own working tree before the system
  even bootstraps is bureaucratic.
- **`git stash` the modifications, bootstrap, then re-apply.** Rejected: stash
  is implicit and loses commit attribution. Atomic commits with descriptive
  messages preserve why each change exists.
- **`git checkout -- .` to discard the dirty state.** Rejected: that destroys
  the V4-era defensive fixes that are real improvements. NEVER discard
  uncommitted work without confirming it's noise (§0.4 the destructive-ops
  rule applies in spirit).
- **Cherry-pick only the orchestrator code, discard the reports.** Rejected:
  unnecessarily clever. The reports represent real V3 operational state and
  cost nothing to commit. They'll be superseded by the L7 memory files in
  this same cycle.

## Linked regression test

None — this is a one-time bootstrap-flow judgment. The `compute_level.py`
test suite from this cycle does cover the more general "is the L7 protocol
correctly bootstrapped" question. A future cycle (e.g. Track M3) may add a
lint that rejects CONTEXT.md changes without an ADR; that lint will test
this ADR-linkage invariant.

## Linked cycle

Cycle `20260512-042701` (the Bootstrap cycle that wrote this ADR).
