# Release Policy

## Current Release Grade

`v1.0.0` remains the only GA tag.

For the TypeScript v2 line, `v2.2.0-rc2` is the production tag for this
single-operator, single-machine system. This follows
`docs/adr/0013-rc-grade-is-prod-grade.md`: rc-grade is accepted as the
production grade for personal infrastructure, and no `v2.2.0` GA tag is
created unless a future ADR reopens the decision with a real soak record.

## Tag Rules

- Do not create `v2.1.0` or `v2.2.0` GA tags under the current policy.
- Keep `v2.1.0-rc2` and `v2.2.0-rc2` as the highest v2.1/v2.2 release
  references.
- Future v2.2 patch releases use the same convention unless superseded by ADR:
  `v2.2.1-rc1`, `v2.2.1-rc2`, and so on.
- `v2.3.x` may define its own policy in a new ADR, but must not silently
  reinterpret the v2.2 rc-grade decision.

## Verification

Before claiming a release tag state, verify both local and remote tags:

```bash
git tag --list 'v2*' --sort=v:refname
git ls-remote --tags origin 'v2*'
```

As of 2026-05-28, the expected v2 tags are:

```text
v2.1.0-rc1
v2.1.0-rc2
v2.2.0-rc1
v2.2.0-rc2
```
