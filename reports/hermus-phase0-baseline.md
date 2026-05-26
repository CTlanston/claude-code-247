# Hermus Phase 0 Baseline

Updated: 2026-05-26

## Purpose

This baseline records the starting point for using `claude-code-247` / `aedev`
as the mother system that drives Hermus through the Phase 0-6 plan.

## Local Project Inventory

- `/Users/lanston/projects/aedev-sandbox` — small Vite/TypeScript sandbox, clean Git status during baseline inspection, suitable for low-risk experiments.
- `/Users/lanston/projects/auto-evo-playground` — GitHub Actions Python auto-evo prototype with local dirty files.
- `/Users/lanston/projects/claude-code-247` — mother system; TypeScript `aedev` control plane plus Python `claude247` kernel.
- `/Users/lanston/projects/hermus-agent` — Hermus v0 seed implementation; target project for first PR loop.
- `/Users/lanston/projects/secrets-mcp` — sensitive-looking project; scan only with redaction and no secret output.

## Mother System Baseline

- Branch: `converge/product-spine`.
- Local state: ahead of `origin/converge/product-spine` by 10 commits, with uncommitted work already present.
- `pnpm test`: 226 passed, 6 skipped.
- `pnpm typecheck`: pass.
- `pnpm lint`: pass.
- Phase 1-6 capability is test-green at unit/integration scope, but real Hermus PR-loop proof is tracked separately.

## Hermus Seed Baseline

- Existing Hermus v0 is preserved as seed code, not treated as final proof.
- `python3 -m pytest -q`: pass.
- Hermus v0 can generate local `.memory/runs/<run-id>/report.html`.
- Hermus v0 requires hardening for GitHub notification failure handling and PR-loop execution.

## Decisions

- Keep Hermus as an independent repository target.
- Use active GitHub account owner `CTlanston` for concrete GitHub operations because local `gh auth status` reports that account.
- Notification hub is `CTlanston/claude-code-247`.
- First PR-loop target is `CTlanston/hermus-agent`.
- No `.github/**`, secret, credential, branch-protection, or production control-plane paths are modified for the first PR-loop.
