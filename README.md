# claude-code-247

> Your local-first, multi-repo, 24/7 autonomous coding coworker. The Mac
> stays on; Claude Code authenticated locally drives Docker-isolated
> workers across every repo in your registry, opens draft PRs on GitHub,
> runs external validators, scores risk, and merges low-risk changes
> automatically — gated by your phone if anything bigger.

## What you get

- **Multi-repo from day one.** One registry, many repos. Per-repo budget,
  risk policy, allowed/forbidden paths.
- **Local-first execution.** Mac + Docker. Your authenticated Claude
  Code session is the default; the paid API is opt-in.
- **Mobile control.** `claude247 status --plain` is built for SMS-sized
  output. ntfy.sh pushes for approvals and stuck tasks.
- **External validator isolation.** Gemini 2.5 Pro and an OpenAI-compatible
  judge see only the evidence package — never the Coder's conversation.
- **Low-risk auto-merge** with score 0–100; medium asks your phone, high
  blocks.
- **Long-term memory** that compiles failures, lessons, and decisions
  back into per-repo `.agent/*.md` files.
- **Failure replay** for any task.

## Quick start

```bash
# 1. Install the package and CLI
make install                    # creates venv + installs deps + launchd plists

# 2. Check the environment
claude247 doctor

# 3. Add your first repo (CLI wizard)
claude247 repo add

# 4. Run the dashboard
open http://localhost:8423      # or `claude247 dashboard open`

# 5. Kick off a task
claude247 start --repo my-repo --goal "refactor the auth middleware"
```

## Status

This is a v1 transformation in progress. See
[IMPLEMENTATION_PLAN.md](IMPLEMENTATION_PLAN.md) for the milestone roadmap
and [archive/auto-evo/docs/legacy-docs/](archive/auto-evo/docs/legacy-docs/)
for the prior Auto-Evo + AutoDev v3 architecture this replaces.

## Documentation (filling in as milestones land)

- `docs/ARCHITECTURE.md` — module map and data flow
- `docs/INSTALL.md` — full install + uninstall + doctor
- `docs/REMOTE_DISPATCH.md` — phone / Remote / Dispatch operating guide
- `docs/SECURITY.md` — secret hygiene, forbidden paths, approval flow
- `docs/MEMORY.md` — vector + .agent file architecture
- `docs/AUTO_MERGE_POLICY.md` — risk scoring and merge gates
- `docs/VALIDATORS.md` — Gemini + OpenAI judge contracts
- `docs/REPO_ONBOARDING.md` — adding repos
- `docs/OPERATIONS.md` — day-to-day operating playbook

## License

Internal.
