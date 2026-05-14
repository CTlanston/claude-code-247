You are wrapping up a successful recovery. Read this whole file first, then execute step by step. Stop and ask me only on the explicit STOP points.

## Context

Working dir: /Users/lanston/projects/claude-code-247
Harness purpose: this is the 4-role auto-evolve orchestrator that operates on the test repo CTlanston/auto-evo-playground via GitHub Issues + shadow branches.

We just recovered the orchestrator from a Guardian-induced freeze. Root cause:
- record_run double-writes (same cost_usd appears 2-6 times)
- record_run writes stale cost when usage.input_tokens=output_tokens=0
- Under subscription/OAuth, Anthropic CLI sometimes returns nonzero total_cost_usd estimates
- Combined → daily_cost_usd inflated to $22 ($17.56 was phantom)
- Guardian (Opus) correctly flagged "token spike" and froze dispatch
- Tracked partially in DEFERRED.md but never patched at source

A tactical patch was already applied to `orchestrator/main.py` around line ~510 in the `run_guardian` function: it adds a `_is_subscription` guard that force-zeros `daily_cost_usd` when `ANTHROPIC_API_KEY` starts with `sk-ant-oat01-`. The patch lives on disk already; you didn't write it in this session, but it's there. The 27 phantom rows have already been DELETED from `state/orchestrator.db`. `state/PAUSED` has been removed. The container has been rebuilt and verified: `GUARDIAN DONE`, no `recommends pause`, `state/PAUSED` is not recreated, and `state/metrics.json` shows `daily_cost_usd: 0.0`.

## What you must do

### 1. Verify the patch is present
- Run: `grep -n "_is_subscription" orchestrator/main.py`
- Expected: two matching lines around line 516-517.
- If missing: STOP and tell me. Don't try to recreate it.

### 2. Initialize git tracking
The harness has never been committed.
- Run `git init`
- Create a `.gitignore` with:
  - Python: `__pycache__/`, `*.pyc`, `.venv/`, `.env`
  - Orchestrator state (operational data, not source): `state/*.db`, `state/*.db-*`, `state/*.bak.*`, `state/PAUSED`, `state/PAUSED.human`, `state/metrics.json`, `workspaces/`
  - macOS: `.DS_Store`
  - Keep `.env.example` tracked (it has no secrets)
- Run `git status` and show me the output.
- **STOP** for my approval before staging anything.

### 3. Make two clean commits (after I approve)

**Commit A** (the hotfix only):
- Stage: only `orchestrator/main.py`
- Message:
  ```
  fix(guardian): force-zero daily_cost_usd under subscription auth

  Token metering has known stale-state + double-write bugs (see DEFERRED.md)
  that inflate cumulative cost under OAuth/subscription mode where actual
  spend is $0. Guardian (Opus) correctly flagged this as "token spike" and
  froze dispatch. Patch detects OAuth token prefix (sk-ant-oat01-) and
  zeros the cost field before Guardian reads it.

  True fix is to make record_run idempotent and skip writes when usage
  metering returns zero tokens — tracked as a separate issue.
  ```

**Commit B** (baseline snapshot of the rest of the harness):
- Stage everything else not in `.gitignore`
- Message: `chore: initial harness snapshot post-recovery`

### 4. DO NOT push to any remote
No remote is configured. Do not run `git remote add`, `git push`, or anything that contacts a server. If you have a suggestion for the remote URL, write it as a comment into a new file `.git-remote-suggestion.txt` and ask me at the end.

### 5. Update DEFERRED.md
Append a new section at the end:

```
## Phantom-cost metering bug (May 8 freeze)

**Symptom:** Guardian froze dispatch on May 8 21:43 UTC with `recommends pause`. State/PAUSED was created; no .human companion (i.e. automatic, not user-triggered).

**Root cause:** Pollution in `state/orchestrator.db` runs table:
- 39 total runs, $22.07 cumulative cost_usd
- 27 rows (69%) had `input_tokens=output_tokens=0` but `cost_usd > 0` — stale state from previous run's cost being copied forward
- Same cost_usd value duplicated across multiple rows: `$0.19 × 6`, `$1.75 × 2`, `$1.03 × 2`, `$0.76 × 2`, `$0.43 × 2` — record_run double-write
- Real cost was ~$4.50, the other $17.56 was phantom

Guardian (Opus 4.7) read $22 daily_cost_usd vs ~$0 7-day average → token-spike alert per guardian.md rule 1 → ≥1 error condition → pause.

**Tactical patch (this commit A):** `main.py:run_guardian()` short-circuits `daily_cost_usd` to `0.0` when `ANTHROPIC_API_KEY` starts with `sk-ant-oat01-`. Phantom rows manually pruned.

**Root fix:** Make `record_run` idempotent and stop writing stale cost on zero-token runs. Tracked as [insert issue URL from step 6 here].
```

After writing, run `git diff DEFERRED.md` and show me.

### 6. Create the GitHub issue for the root fix

First write `/tmp/autodev-issue-body.md` with this exact content:

```
## Bug
orchestrator.db `runs` table accumulates phantom cost rows under subscription/OAuth auth:
- ~69% of runs have `input_tokens=output_tokens=0` but `cost_usd>0` (stale-state from prior run)
- Same `cost_usd` value duplicated 2–6 times ($0.19 × 6, $1.75 × 2, $1.03 × 2, $0.76 × 2, $0.43 × 2) → record_run double-write
- Combined: $22 accumulated for $4.5 worth of real work; Guardian (correctly) freezes dispatch on phantom "token spike"

Currently mitigated by `main.py:run_guardian` short-circuiting `daily_cost_usd` to 0 under OAuth. This issue removes the need for that workaround.

## Acceptance
1. Test: calling `record_run` twice with the same (issue_id, role, started_at) writes only one row (idempotent INSERT).
2. Test: when CLI returns `usage.input_tokens=0` and `usage.output_tokens=0`, `cost_usd` is forced to 0 regardless of `total_cost_usd` in the JSON.
3. `orchestrator/db.py:record_run` — add UNIQUE constraint on (issue_id, role, started_at) and use `INSERT OR IGNORE` / `ON CONFLICT`.
4. `orchestrator/runner.py` — when parsing CLI JSON envelope, if `usage.input_tokens == 0` then force `cost_usd = 0` before passing to `record_run`.
5. Keep `main.py:run_guardian` `_is_subscription` guard as a defense-in-depth seatbelt (do not remove it).
6. Add a migration step or runtime guard so existing DBs without the UNIQUE constraint don't break on first write.

## Out of scope
- Backfilling deleted phantom rows (already manually pruned: 27 rows / $17.56)
- Changing the billing / cost-tracking model under subscription
- Adding alternative metering sources
```

Then run:
```
gh issue create --repo CTlanston/auto-evo-playground \
  --label agent:auto \
  --title "Fix record_run double-write + zero-token phantom cost" \
  --body-file /tmp/autodev-issue-body.md
```

Capture the issue URL it prints. Then go back to `DEFERRED.md` and replace `[insert issue URL from step 6 here]` with the real URL, then `git commit --amend --no-edit` so the URL is in commit A's `DEFERRED.md` update (or in commit B if you committed DEFERRED.md there — whichever is correct).

### 7. Report back
Print a compact summary:
- `git log --oneline -3`
- The added section diff in `DEFERRED.md`
- The URL of the issue you created
- Anything you skipped or couldn't do, and why

## Hard constraints
- Do NOT git push to any remote in this session.
- Do NOT add `.env` or `state/orchestrator.db` to git tracking.
- Do NOT modify any code file other than DEFERRED.md (and the new files you create like `.gitignore`, `/tmp/autodev-issue-body.md`, optionally `.git-remote-suggestion.txt`). The `orchestrator/main.py` patch is already on disk.
- If anything looks risky or unclear, STOP and ask me. Don't improvise.
