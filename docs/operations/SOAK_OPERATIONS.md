# SOAK OPERATIONS — one-week real fleet soak (V6-P5)

> Runbook for taking the proven in-container soak harness
> (`scripts/fleet-soak.ts`, 5/5 PASS with simulated executors) to a real,
> unattended, ≥1-week run on the operator's Mac. Closes assessment gap #19's
> apparatus; the soak RESULT itself stays honest: until a week-long run's
> evidence lands in-repo, rubric #19 remains **unproven** (GR#7).
>
> Status artifact contract: `packages/daemon/src/soak-status.ts` (tested).
> CLI: `pnpm soak:status` (`scripts/soak-status.ts`).

## 1. The one-week command

```bash
cd ~/projects/claude-code-247
# 604800000 ms = 7 days. Evidence lands in evidence/fleet-soak/<ISO-timestamp>/.
AEDEV_SOAK_MS=604800000 pnpm test:fleet:soak
```

Recommended unattended wrapper (status artifact + ntfy on exit):

```bash
pnpm soak:status start \
  && if AEDEV_SOAK_MS=604800000 pnpm test:fleet:soak; then
       pnpm soak:status complete
     else
       pnpm soak:status fail
     fi
```

Notes:
- The harness itself already enforces the safety/test env: remote writes off,
  all external CLIs/APIs disabled — a week-long soak spends **zero** credit
  while idle (idle-zero-credit is one of its PASS criteria).
- `AEDEV_SOAK_INTERVAL_MS` (default 200) can be raised to 1000–5000 for a
  week-long run to keep CPU negligible.

## 2. `soak-pending.json` status artifact (contract)

Path: `evidence/fleet-soak/soak-pending.json`
(override: `AEDEV_SOAK_PENDING_PATH`). Exact shape:

```json
{
  "started_at": "2026-06-11T00:00:00.000Z",
  "expected_end": "2026-06-18T00:00:00.000Z",
  "status": "running"
}
```

- `status` ∈ `running | completed | overdue | failed`.
- `expected_end = started_at + AEDEV_SOAK_MS` (default one week).
- `running` past `expected_end` **reads as** `overdue` — honest "needs a
  human look", never a silent fake-complete. `completed`/`failed` are
  terminal and sticky.
- Readers fail closed: a missing/corrupt artifact reads as "no soak pending"
  (`pnpm soak:status` exits 1), so nothing acts on half-written state.

Commands:

```bash
pnpm soak:status            # read + time-derived status
pnpm soak:status start      # window from AEDEV_SOAK_MS (default 1 week)
pnpm soak:status complete   # after the report is generated and checked
pnpm soak:status fail       # the run died and will not be resumed
```

## 3. Evidence directory contract

```
evidence/fleet-soak/
  soak-pending.json              status artifact (§2)
  <ISO-timestamp>/               one directory per soak run (the harness creates it)
    soak-report.md               PASS/FAIL per criterion + honesty note
    metrics.json                 machine-readable criteria, drill, idle counters
```

The report MUST keep the harness's real/simulated classification: real
daemon + real HTTP + real Ed25519 vs simulated executors. A week-long run
with simulated executors still does NOT check rubric #19's "real-CLI on
operator machines" box — say so in the report.

## 4. launchd (unattended + crash recovery)

Mirror of `scripts/launchd/com.claude247.daemon.plist.tpl` (node executes the
entry DIRECTLY so launchd tracks the real PID — no pnpm/tsx wrapper chain).
Save as `~/Library/LaunchAgents/com.claude247.fleet-soak.plist`, replacing the
`@@…@@` placeholders like `scripts/install_launchd.sh` does:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.claude247.fleet-soak</string>
  <key>ProgramArguments</key>
  <array>
    <string>@@NODE@@</string>
    <string>--import</string>
    <string>tsx</string>
    <string>@@REPO_ROOT@@/scripts/fleet-soak.ts</string>
  </array>
  <key>WorkingDirectory</key><string>@@REPO_ROOT@@</string>
  <key>KeepAlive</key>
  <dict>
    <key>SuccessfulExit</key><false/>
  </dict>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>@@LOG_DIR@@/fleet-soak.out.log</string>
  <key>StandardErrorPath</key><string>@@LOG_DIR@@/fleet-soak.err.log</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>HOME</key><string>@@HOME@@</string>
    <key>PATH</key><string>@@PATH@@</string>
    <key>AEDEV_SOAK_MS</key><string>604800000</string>
    <key>AEDEV_SOAK_INTERVAL_MS</key><string>1000</string>
    <key>AEDEV_NTFY_TOPIC</key><string>@@NTFY_TOPIC@@</string>
  </dict>
</dict>
</plist>
```

```bash
launchctl load  ~/Library/LaunchAgents/com.claude247.fleet-soak.plist   # install + start
launchctl list | grep fleet-soak                                        # check
launchctl unload ~/Library/LaunchAgents/com.claude247.fleet-soak.plist  # stop/remove
```

`KeepAlive.SuccessfulExit=false` is the crash-recovery: a crash (or
`kill -9`) restarts the harness; a clean PASS/FAIL exit does not loop.

## 5. Resume after a crash / kill -9

The harness is self-contained per run (each start creates a fresh
`evidence/fleet-soak/<ts>/`): resume = restart. One step back to standby:

```bash
launchctl kickstart -k gui/$(id -u)/com.claude247.fleet-soak
# without launchd:
pnpm soak:status start && AEDEV_SOAK_MS=604800000 pnpm test:fleet:soak
```

Honesty rule for the report: a restarted soak's wall-clock week starts over
(`soak-pending.json` shows the real `started_at`). Do not stitch two partial
runs into one "week" — record both directories and say what happened.

## 6. Failure recovery

| Symptom | Recovery |
|---|---|
| `pnpm soak:status` says `overdue` | The window elapsed without a completion mark. Check `@@LOG_DIR@@/fleet-soak.*.log` and the run's `soak-report.md`; then `pnpm soak:status complete` (report ok) or `fail` (run died) |
| Harness exits non-zero (criterion FAIL) | The report names the failing criterion. Read `metrics.json`, fix, restart (§5). Mark `pnpm soak:status fail` for the dead run |
| launchd crash-loop (`fleet-soak.err.log` repeats) | `launchctl unload`, fix the cause, `launchctl load` again. The plist never restarts after a clean exit, so loops mean a real startup error |
| Mac rebooted mid-soak | `RunAtLoad` restarts it on login; restart-honesty rule of §5 applies |
| Artifact corrupt/missing | Readers fail closed (§2); `pnpm soak:status start` rewrites it (a fresh window — say so in the report) |

## 7. ntfy wiring

Same pattern as `scripts/notify-pr-ready.sh` — topic from `AEDEV_NTFY_TOPIC`
(optional self-hosted base via `AEDEV_NTFY_URL`); without a topic it prints
instead of pushing (never blocks):

```bash
# soak finished (wrap the §1 command):
pnpm soak:status start \
  && if AEDEV_SOAK_MS=604800000 pnpm test:fleet:soak; then
       pnpm soak:status complete
       curl -fsS -X POST "${AEDEV_NTFY_URL:-https://ntfy.sh}/$AEDEV_NTFY_TOPIC" \
         -H "Title: aedev · fleet soak PASS" -H "Priority: high" \
         -d "one-week soak complete — report in evidence/fleet-soak/"
     else
       pnpm soak:status fail
       curl -fsS -X POST "${AEDEV_NTFY_URL:-https://ntfy.sh}/$AEDEV_NTFY_TOPIC" \
         -H "Title: aedev · fleet soak FAIL" -H "Priority: urgent" \
         -d "soak failed — check evidence/fleet-soak/ and logs"
     fi
```

Hold-change pushes during the soak are already covered by the daemon-side
watchdog (`packages/daemon/src/watchdog.ts` → `ntfy.ts`): every new
`HOLD-*` (including the forged-evidence drill's `HOLD-EVIDENCE-MISMATCH`)
emits `operator.notify_requested` + an ntfy push when the daemon runs with
`AEDEV_NTFY_TOPIC` set.

## 8. Report template (real/simulated explicit — GR#7)

The harness writes `soak-report.md` per run. For the week-long acceptance,
append this classification block before committing the evidence:

```markdown
## Classification (GR#7)
- real: daemon, HTTP fleet protocol, Ed25519 identities, freeze path, durations
- simulated: task executors (no subscription CLI was spawned)
- unproven-after-this-run: real-CLI multi-machine soak (rubric #19 full check)
- restarts during the week: <n> (directories: <list>)
```
