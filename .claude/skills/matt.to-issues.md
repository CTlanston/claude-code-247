# Skill: matt.to-issues

> A Wave 1 stub. Track K2 (future) will wire this into the
> `orchestrator/skill_router.py` classifier.

## Purpose

Turn a vague / sprawling task description into a set of small,
well-formed GitHub issues that the inner engine can dispatch.

## When to invoke

Trigger this skill when:

- The operator drops a multi-paragraph request that touches >1
  subsystem
- A BACKLOG item is too coarse to fit in a single 45-min cycle
- A FAILURES.md entry mentions multiple distinct symptoms that
  should be addressed separately
- An ADR proposes a multi-step migration

## What this skill does

For each input task:

1. **Identify scope boundaries**. Group related work together,
   separate independent work.
2. **Draft one GitHub issue per scope**, each with:
   - Title (concise; under 70 chars)
   - Problem statement (1-2 paragraphs; why does this matter?)
   - Acceptance criteria (bulleted; test-shaped where possible)
   - Files likely to touch (closed set; reduces blast radius)
   - Risk score (low / medium / high / critical)
   - Estimated cycles (1 / 2-3 / many)
3. **Order the issues** by dependency. Surface "Issue X blocks
   Issue Y" relationships explicitly.
4. **Stop and ask the human** before posting issues to the
   real test repo. The skill writes drafts to
   `tasks/draft-issues-<ts>.md`; the operator reviews and posts.

## What this skill does NOT do

- **Does NOT** post issues to GitHub directly. Issue creation is
  an operator action (§0 rule 10 spirit: irreversible-ish
  external side effect).
- **Does NOT** auto-assign issues. The supervisor's
  `Scheduler.dispatch_next()` picks based on priority + capable
  worktree.
- **Does NOT** make architectural calls. If a draft issue requires
  "should we use SQL vs NoSQL" type decisions, the skill writes
  the question to BLOCKED.md and escalates.

## Exit criteria

- A draft-issues file exists in `tasks/draft-issues-<ts>.md`
- Each draft has all required fields
- The operator either approves (skill is "done") or rejects
  (skill iterates)

## Related artifacts

- `AUTODEV_L7_MASTER_PROMPT.md` §7 Planner contract (issues feed
  into Planner)
- `tasks/backlog.md` (autonomous-driven queue)
- `BACKLOG.md` (rubric-track queue; distinct from issue queue)
