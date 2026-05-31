# ⚠️ TEMPLATE — this file is NOT the trigger

The downstream **Scheduled Task** `operator-cockpit-e2e-repair-loop` fires hourly but does
nothing until this EXACT file exists:

```
docs/handoff/operator-cockpit-e2e-product-repair-handoff.md
```

This `*.TEMPLATE.md` file does **not** match that path, so it will **not** trigger the loop.

## How to hand off (do this when the upstream task is genuinely done)

When the Claude Code task **"Claude-code-247 / Operator Cockpit E2E product repair"**
completes and you've finished its work, copy this template to the exact trigger name and
fill it in:

```bash
cp docs/handoff/operator-cockpit-e2e-product-repair-handoff.TEMPLATE.md \
   docs/handoff/operator-cockpit-e2e-product-repair-handoff.md
# then edit the copy with the real values below, and (optionally) commit it
```

The moment that file exists, the next hourly run starts **Round 1** of the E2E repair loop:
run the system → real-browser E2E of the Web UI → log findings into
`docs/execution-workbooks/operator-cockpit-e2e-repair-loop.md` → fix confirmed bugs →
open a `codex/...` PR (merge stays gated by `allow_remote_writes`) → per-round handoff → repeat,
until two consecutive clean rounds on `main`.

> **One-liner to paste into the upstream task's instructions:**
> "When this task completes, write `docs/handoff/operator-cockpit-e2e-product-repair-handoff.md`
> (from `…-handoff.TEMPLATE.md`) — its existence is the trigger for the E2E repair loop."

---

## Sentinel handoff contents (fill these in)

- **Status:** complete / partial — and what "complete" means here.
- **Baseline:** the branch + commit SHA the repair loop should test from (default `main`).
- **What was delivered:** scope of the upstream Operator Cockpit E2E product repair.
- **Validation evidence:** commands run + results (typecheck / lint / `pnpm test` /
  `pnpm test:cockpit:e2e`), with pass/fail counts and any caveats.
- **Known open issues / defects:** anything you already know is broken or rough — severity
  P0/P1/P2/P3, repro, and user impact. (The loop will independently re-test; this is a head start.)
- **Out of scope / do-not-touch:** areas the loop should leave alone.
- **Entry point for Round 1:** where to start, what to exercise first, any setup the loop needs.
- **Remote-write state:** is `allow_remote_writes` expected on or off, and is this repo
  `enabled:true` in `~/.claude-code-247/repos.yaml`? (Determines whether the loop may push/merge.)
