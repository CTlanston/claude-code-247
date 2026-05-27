# Workbook Amendment Proposal · @aedev vs @claude247 Package Namespace

**Date:** 2026-05-27
**Author:** session s_0002 (under ADR-0011 bound 4)
**Per:** EXECUTION_WORKBOOK §7.4
**Affects:** §3 Stage A — Stage M4 prose references to package names.
**Status:** DRAFT — awaiting reviewer + operator dual sign-off per §7.2.

---

## Motivation

EXECUTION_WORKBOOK §3 prose names packages like `@claude247/event-log`,
but every shipped package on the v2-foundation branch uses the
`@aedev/*` scope (`@aedev/event-log`, `@aedev/cli-robust`,
`@aedev/interrupt-bus`, etc). This was a deliberate choice in s_0001
to stay consistent with the pre-existing workspace convention (the
v1 workspace had `@aedev/core`, `@aedev/daemon`, etc).

The Stage A L2 reviewer flagged this in session s_0001:

> "Workbook deviation — package namespace. The workbook prescribes
> @claude247/event-log; the shipped package is @aedev/event-log. ...
> This reviewer does not consider it a defect — internal naming, no
> downstream contract — but flags it so future merges with the
> workbook stay consistent. Either rename the package or amend the
> workbook line; do not let the inconsistency persist past v2.1."

ADR-0011 §"Open items this ADR explicitly does NOT close" defers the
decision. This proposal makes it.

## Options

### Option A — Keep `@aedev/*` (recommended)

- **Pros**
  - 13 packages already under `@aedev/*`; renaming churns 100+ files
    and the pnpm-lock for cosmetic gain.
  - `@aedev/core` predates the v2 workbook draft; the workbook prose
    was aspirational, not the source of truth.
  - The CLI command `claude247` (gateway / SMS-shaped operator
    interface) is the user-facing brand; package scope is internal.
- **Cons**
  - Workbook prose remains inconsistent with code until amended.

### Option B — Rename to `@claude247/*`

- **Pros**
  - Workbook prose stays as-written.
  - The package scope matches the product name.
- **Cons**
  - Rename touches `package.json` × 14, `pnpm-workspace.yaml`, every
    `workspace:*` reference, `pnpm-lock.yaml`, all imports across
    `packages/`, `apps/`, `scripts/`. Risk of breakage is high for a
    cosmetic change.
  - v1 GA tag points at code with `@aedev/*`; rename creates a hard
    discontinuity for anyone bisecting against v1.

## Recommendation

**Option A — keep `@aedev/*`.** Amend the workbook prose to use the
implemented namespace.

### Concrete edits (when accepted)

Find every literal `@claude247/<pkg>` in EXECUTION_WORKBOOK.md and
replace with `@aedev/<pkg>`. Specifically:

- §3 Stage A L1: `pnpm test --filter @claude247/event-log` →
  `pnpm test --filter @aedev/event-log`
- (Sample — operator may find others when applying.)

Add a note under §4 (cross-cutting) clarifying:

> "Workspace package scope is `@aedev/*` (carried over from v1).
> The user-facing CLI binary name `claude247` is the brand; package
> names are internal."

## What this amendment does NOT change

- §1 GROUND RULES — untouched.
- The `claude247` CLI command name / launchd label / dashboard URL —
  those remain `claude247-*` per user-facing branding.
- The v1 `~/.claude-code-247/` state directory — operator data, not
  package metadata, remains stable across v1/v2.

## Reviewer checklist

- [ ] Confirm `pnpm-workspace.yaml` packages are all `@aedev/*`
- [ ] Confirm Option A's rename-cost claim by running
      `grep -rE "@(claude247|aedev)/" --include='*.json' --include='*.ts' | wc -l`
- [ ] Confirm no v1 release-notes reference `@claude247/*` as a public
      contract surface
- [ ] Sign off on Option A or counter-propose Option B with refactor
      plan

## Sign-off

- Reviewer agent: _<signature line>_
- Operator (lanston): _<signature line>_

Upon dual sign-off, apply the workbook edits, bump §10 changelog to
v1.3 (or v1.4 if the hold-policy-naming amendment landed first), and
move this proposal to `proposals/applied/`.

## Failure path

If reviewer rejects Option A: produce a refactor plan PR and migrate.
If operator rejects: archive.
