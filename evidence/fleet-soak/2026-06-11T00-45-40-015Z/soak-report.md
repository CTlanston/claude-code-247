# Fleet Soak Report — v5-P4 (in-container short soak)

Result: **PASS**
Timestamp: 2026-06-11T00-45-40-015Z
Duration: 120s (AEDEV_SOAK_MS=120000, intervalMs=200)
Evidence dir: /home/user/claude-code-247/evidence/fleet-soak/2026-06-11T00-45-40-015Z

Harness: real daemon (createServer, :memory: SQLite, temp stateDir), remote writes disabled,
all external CLIs/APIs disabled, 5 real FleetWorkerAgent loops over real HTTP on 127.0.0.1,
simulated executors producing passing evidence, simulated CI landing for each completion.

## Workers

| worker | operator | tasks executed | final registry status |
|--------|----------|----------------|------------------------|
| w-alice-1 | alice | 18 | active |
| w-bob-1 | bob | 16 | active |
| w-carol-1 | carol | 16 | active |
| w-dave-1 | dave | 20 | active |
| w-eve-1 | eve | 5 | frozen (drill) |

Tasks seeded: 75 · executed: 75 · drill task: 01KTT293K9HE7Z3GP33VCH9NS1

## Criteria

### provisioning — PASS

5 workers (5 operators) registered with real ed25519 keypairs
- registered: 5/5
- distinct public keys in registry: 5

### no-double-execution — PASS

Claim-ledger uniqueness: every task executed exactly once across 5 workers
- tasks seeded: 75 · executions: 75
- executed twice: 0 · never executed: 0 · with ≠1 claim event: 0
- queue drained inside the soak: true (t+66s)
-   w-alice-1 (alice): 18 tasks executed
-   w-bob-1 (bob): 16 tasks executed
-   w-carol-1 (carol): 16 tasks executed
-   w-dave-1 (dave): 20 tasks executed
-   w-eve-1 (eve): 5 tasks executed

### forged-evidence-drill — PASS

Drill: self-reported PASS vs simulated-CI FAIL → HOLD + freeze + later claims 403; other 4 keep working
- verdict: mismatch=true worker=w-eve-1 gates=[test]
- HOLD-EVIDENCE-MISMATCH on task 01KTT293K9HE7Z3GP33VCH9NS1: open
- fleet.worker_frozen events: 1 · registry status: frozen
- w-eve-1 results after freeze: 517, of which 403 worker_frozen: 517, completions: 0
-   w-alice-1 completions after the freeze: 14
-   w-bob-1 completions after the freeze: 12
-   w-carol-1 completions after the freeze: 12
-   w-dave-1 completions after the freeze: 16

### idle-zero-credit — PASS

Idle ≥3 loop intervals after drain with ZERO cost.headless_call events
- active workers observed idling: w-alice-1, w-bob-1, w-carol-1, w-dave-1
-   w-alice-1: +3 idle polls in the measured window (601ms)
-   w-bob-1: +3 idle polls in the measured window (601ms)
-   w-carol-1: +3 idle polls in the measured window (601ms)
-   w-dave-1: +3 idle polls in the measured window (601ms)
- cost.headless_call during idle window: 0 · entire soak: 0

### operator-attribution — PASS

Per-operator event attribution: claims/evidence/lifecycle carry registry-bound operatorId + workerId
- executions with fully consistent attribution: 75/75
-   operator alice: 18 claim events vs 18 executions
-   operator bob: 16 claim events vs 16 executions
-   operator carol: 16 claim events vs 16 executions
-   operator dave: 20 claim events vs 20 executions
-   operator eve: 5 claim events vs 5 executions

## Honesty note

in-container short soak with simulated executors — validates the harness + protocol under
concurrency; the ≥1-week real-CLI soak on operator machines remains open (rubric #19 stays
unchecked until then).
