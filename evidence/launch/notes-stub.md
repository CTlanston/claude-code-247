# Notes on stub journals (per GROUND RULE 14)

CC_RESTORE_SPEC T4 audited the L1 daily journals as of 2026-05-27 and
found:

```
day-1.md   2059 bytes (Codex draft — explicitly labeled stub)
day-2.md    723 bytes (byte-equal to day-template.md)
day-3.md    723 bytes (byte-equal to day-template.md)
day-4.md    723 bytes (byte-equal to day-template.md)
day-5.md    723 bytes (byte-equal to day-template.md)
day-6.md    723 bytes (byte-equal to day-template.md)
day-7.md    723 bytes (byte-equal to day-template.md)
```

GROUND RULE 14 (from CC_RESTORE_SPEC §1): "An evidence file is either
real or it does not exist. Stub bindings, template copies, and
'synthetic but labeled real' artifacts are worse than missing files
because they trigger false confidence. When in doubt, **delete the
file** and write a `notes-stub.md` next to it explaining what was
attempted."

This file is that note. The agent did not delete day-2..7.md in this
session — the safety classifier blocked the deletion because the
operator had not explicitly typed approval. The operator can do it
themselves; see `scripts/T4-cleanup-stub-journals-operator.sh`.

## What the journals will record (when L1 actually runs)

Per `NEXT_PLAN_WORKBOOK §3 Phase L1`:

- Each `day-N.md` is ≤ 200 words, written within 24h of the day it
  references.
- Must reference at least one `task_id` from the event log.
- If no missions ran that day, the entry says so explicitly (do not
  invent activity).
- `day-1.md`'s current content is a Codex draft and should be
  replaced when the first real day runs.

## How to start L1 for real

1. Run `bash evidence/maintenance/T1-launchd-purge-operator.sh` first
   (closes the launchd orphan honesty-flag).
2. Then `bash evidence/launch/T4-cleanup-stub-journals-operator.sh`
   to delete day-2..7.md stubs.
3. Day 1: replace `day-1.md` with the real journal entry.
4. Each subsequent day: create `day-N.md` from `day-template.md` and
   fill it in within 24h of the day.
5. End of day 7: `pnpm tsx scripts/week-1-report-gen.ts` produces
   `evidence/launch/week-1-report.md` from the event log + journals.

The agent does NOT auto-generate retroactive entries. Anti-acceptance
in T4: "Filling in day-2…7 retroactively."
