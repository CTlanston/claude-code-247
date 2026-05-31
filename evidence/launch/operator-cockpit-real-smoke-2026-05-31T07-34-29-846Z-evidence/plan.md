# Plan

**Plan**
Add one low-risk README clarification and one short note file as evidence. No code changes.

**Concrete Steps**
- Updated [README.md](/private/tmp/claude-501/aedev-real-smoke-state-8mrWtz/operator-workspaces/01KSYFBKSSYVHMPMV36HGJ9Y1A/repo/README.md:5) with a single clarification limiting real smoke changes to docs/evidence notes unless code is explicitly requested.
- Added [cockpit-smoke-note.md](/private/tmp/claude-501/aedev-real-smoke-state-8mrWtz/operator-workspaces/01KSYFBKSSYVHMPMV36HGJ9Y1A/repo/cockpit-smoke-note.md:1) as the short evidence note.

**Diff Summary**
- `README.md`: 1 new clarification line.
- `cockpit-smoke-note.md`: new 3-line note file.

**Risks**
- Very low: documentation-only, no runtime behavior touched.
- Evidence directory was not modified.

**Tests/Checks**
- `git diff -- README.md cockpit-smoke-note.md`
- `git status --short`
- `test -s README.md && test -s cockpit-smoke-note.md`

**Done Report**
Changes are left in the worktree:
- `M README.md`
- `?? cockpit-smoke-note.md`
