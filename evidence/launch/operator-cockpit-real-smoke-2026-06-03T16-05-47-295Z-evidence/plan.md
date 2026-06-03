# Plan

**Plan**
Add one README clarification and one short evidence note file. No code changes.

**Concrete Steps**
- Updated [README.md](/private/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-state-xbc3Id/operator-workspaces/01KT73SVGYRY1BKHNJ8YCRB673/repo/README.md:5) with a one-line roadmap scope clarification.
- Added [evidence-note.md](/private/var/folders/v9/_qhw5dj16gx4mpm8yp_pj5mr0000gn/T/aedev-real-smoke-state-xbc3Id/operator-workspaces/01KT73SVGYRY1BKHNJ8YCRB673/repo/evidence-note.md:1) as the short evidence note.

**Risks**
Low. This is documentation-only and does not touch code, secrets, CI, or forbidden paths.

**Tests/Checks**
- Ran `git diff -- README.md evidence-note.md`.
- Ran `git status --short`.
- Verified file contents with `nl -ba README.md` and `nl -ba evidence-note.md`.
- No automated tests run because the change is docs-only.

**Done Report**
Changes are left in the worktree at the evidence gate:
- `M README.md`
- `?? evidence-note.md`
