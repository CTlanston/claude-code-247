# Hotfix Playbook — NEXT_PLAN_WORKBOOK Phase L2.3

> **When to use:** A v2.x.x bug surfaces post-GA that needs a patch
> release. NOT for refactors, NOT for new features. Use this playbook
> for the smallest possible change set that fixes the bug.

## Decision tree (read first)

1. **Severity Critical?** (data loss, GR-violation, runaway cost,
   security incident)
   → **YES**: page operator immediately; open
     `docs/holds/<incident-NNNN>.md` with reason
     `production_incident`. Stop autonomous missions while you patch.
   → **NO**: continue.

2. **Hotfix fits in a single commit (~50 LoC)?**
   → **YES**: branch from `main`, single commit, follow §"Standard
     hotfix" below.
   → **NO**: this is a refactor in disguise — escalate to a new ADR
     and consider whether a v2.3 spike is the right vehicle.

3. **Hotfix touches GR-class surfaces?** (forbidden paths, schema,
   capability tokens, GROUND RULES, ADRs themselves)
   → **YES**: write or amend an ADR alongside the code change.
     ADR-0014 template applies: `ADR-NNNN-rev1`.
   → **NO**: continue.

## Standard hotfix (post-GA, launch-fast mode)

```sh
# 0. Pre-flight
cd ~/projects/claude-code-247
git checkout main && git pull origin main
pnpm install && pnpm typecheck && pnpm vitest run    # must be green

# 1. Reproduce the bug; add a failing test first
git checkout -b hotfix/<short-slug>
# add a test case that fails on main
pnpm vitest run <new-test-path>                       # confirm RED

# 2. Patch
# … smallest possible diff …
pnpm vitest run                                       # confirm GREEN
pnpm typecheck                                        # clean
pnpm lint                                             # clean

# 3. Stage M (rollback) reverence — verify down-migration still works
pnpm vitest run packages/core/src/rollback-drill.test.ts    # green

# 4. Soak (launch-fast compresses to ≤ 8h; ADR-0011 bound 2 + ADR-0012/0013 template)
pnpm tsx scripts/soak-k-full.ts                        # K compressed soak
# evidence at evidence/stage-K/L1-acceptance/soak-k-full-report.json

# 5. Author ADR if needed
# docs/adr/00XX-hotfix-<slug>.md per the §"ADR template" below

# 6. Commit (single, [hotfix.X.Y.Z] prefix per §4.2 commit grammar)
git add -A
git commit -m "[hotfix.<x>.<y>.<z+1>] <one line>: <details>; accept N/N"

# 7. PR or direct-to-main per repo policy
gh pr create --base main --title "[hotfix.<x>.<y>.<z+1>] ..." --body "$(cat <<EOF
## Repro
...one paragraph or test name...

## Fix
...one paragraph...

## Risk
- Stage M rollback drill: PASS
- compressed soak: PASS (link to evidence)
- GR-class surfaces touched: <yes/no, ADR id if yes>

## Test plan
- [ ] CI green
- [ ] Operator restarts daemon; watches for 1h with mesh on
EOF
)"

# 8. Merge (PR or direct), tag
git tag -a v<x>.<y>.<z+1> -m "hotfix: <one line>"
git push origin main v<x>.<y>.<z+1>

# 9. Update §0 of NEXT_PLAN_WORKBOOK with last_session_id + a §9 entry
```

## When the hotfix needs its own ADR (NNNN-rev1 pattern)

ADR-0012 and ADR-0013 are single-use per soak window. A hotfix that
materially changes the soak surface (e.g., adds a new HOLD reason,
changes the cap-token grammar, alters event log schema) requires:

```markdown
# ADR-00XX-rev1: <hotfix subject> — re-soak record for v<x>.<y>.<z+1>

**Status:** Accepted (post-hotfix)
**Supersedes:** ADR-00XX (only the soak record; the parent ADR's
              decision stays)

## Context
<what broke; one paragraph>

## Decision
<the smallest possible change; one paragraph>

## Re-soak window
- Start: ...
- End: ...
- Threshold readouts: ... (matching the parent ADR's table)

## L3 signoff
`evidence/stage-K{,2}/L3-validate/operator-signoff-hotfix-<x>.<y>.<z+1>.md`
```

## What this playbook DOES NOT cover

- **Multi-package rewrites.** That's a feature; write a NEXT-3 workbook
  or a NEXT_PLAN_WORKBOOK successor.
- **Dependency major version bumps.** Treat as a spike (Phase L3).
- **GROUND RULES amendments.** GR are operator-only via PR (rule 10).

## Soak compression rule (launch-fast mode)

`EXECUTION_WORKBOOK §3 Stage M.L2` mandated 8h integration soak before
a tag. NEXT_PLAN_WORKBOOK §3 Phase L2.3 keeps the 8h ceiling but
**allows compression to 30 min** when:

- the diff is < 50 LoC AND
- the touched surface has 100% test coverage AND
- the K compressed-1-day soak script PASSes post-hotfix AND
- no GR-class surface touched

Anything else: full 8h. Operator decides at PR time.

## Failure path

If the hotfix soak fails (any K-threshold misses):

1. Open `docs/holds/incident-NNNN.md` (reason: `production_incident`)
2. Revert the hotfix branch
3. The bug stays open; root-cause first, hotfix second
4. Operator decides whether to roll mesh back to `mesh.enabled=false`
   while diagnosing
