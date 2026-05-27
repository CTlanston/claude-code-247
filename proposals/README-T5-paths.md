# CC_RESTORE_SPEC T5 — Pick a Path

The audit on `a30c48f` (CC_RESTORE_SPEC §2 row 5) flagged that
`v2.2.0` was tagged GA on a synthetic compressed-1-day soak. Two valid
fixes; operator picks ONE:

| Path | Effort | Honesty story | What changes |
|---|---|---|---|
| [Path A — rc-grade IS production grade](./ADR-0013-revised-pathA-rc-grade.md) | ~1 h | "We always ship rc-grade for single-operator infra; the GA tag was a mistake — fixing it." | Delete `v2.1.0` + `v2.2.0` tags. `v2.2.0-rc2` is the production tag forever. |
| [Path B — earn the real 72h GA](./ADR-0013-revised-pathB-real-72h-soak.md) | ~76 h (72h soak + 4h work) | "We do soak the way the industry expects." | Run the soak, fill the table, force-push the v2.2.0 tag annotation. |

## How to decide

Ask: **does anyone outside this repo care what `v2.2.0` means?**

- **No** (it's just you reading your own changelog) → Path A is cheaper and more honest.
- **Yes** (downstream tooling, a third party, a future you bisecting) → Path B is worth 76 hours.

## What both paths share

- Honesty flag `k2_synthetic_one_day_only` flips off (to `accepted_as_rc` or `false` respectively).
- ADR-0013-revised replaces the current ADR-0013.
- README §Status is updated to match.
- Closes T5 in CC_RESTORE_SPEC.

## What neither path does

- They do NOT roll back `v2.2.0-rc2`. That tag stays.
- They do NOT remove ADR-0011 (operator override) or ADR-0012 (v2.1 30-min soak ADR — same audit-row would apply if you cared to revise it; Path A above already proposes deleting `v2.1.0` too).
- They do NOT change any code on the deployed daemon.

## Operator next step

Read both ADR drafts. Sign the one you want. The other one moves to
`proposals/archived/` for the record.
