# Fleet Soak Report — v5-P4 (in-container short soak)

Result: **PASS**
Timestamp: 2026-06-11T07-35-14-553Z
Duration: 1800s (AEDEV_SOAK_MS=1800000, intervalMs=200)
Evidence dir: /home/user/claude-code-247/evidence/fleet-soak/2026-06-11T07-35-14-553Z

Harness: real daemon (createServer, :memory: SQLite, temp stateDir), remote writes disabled,
all external CLIs/APIs disabled, 5 real FleetWorkerAgent loops over real HTTP on 127.0.0.1,
simulated executors producing passing evidence, simulated CI landing for each completion.

## Workers

| worker | operator | tasks executed | final registry status |
|--------|----------|----------------|------------------------|
| w-alice-1 | alice | 246 | active |
| w-bob-1 | bob | 245 | active |
| w-carol-1 | carol | 251 | active |
| w-dave-1 | dave | 253 | active |
| w-eve-1 | eve | 5 | frozen (drill) |

Tasks seeded: 1000 · executed: 1000 · drill task: 01KTTSQ2M71BX6CQRMYNDH6KHF

## Criteria

### provisioning — PASS

5 workers (5 operators) registered with real ed25519 keypairs
- registered: 5/5
- distinct public keys in registry: 5

### no-double-execution — PASS

Claim-ledger uniqueness: every task executed exactly once across 5 workers
- tasks seeded: 1000 · executions: 1000
- executed twice: 0 · never executed: 0 · with ≠1 claim event: 0
- queue drained inside the soak: true (t+990s)
-   w-alice-1 (alice): 246 tasks executed
-   w-bob-1 (bob): 245 tasks executed
-   w-carol-1 (carol): 251 tasks executed
-   w-dave-1 (dave): 253 tasks executed
-   w-eve-1 (eve): 5 tasks executed

### forged-evidence-drill — PASS

Drill: self-reported PASS vs simulated-CI FAIL → HOLD + freeze + later claims 403; other 4 keep working
- verdict: mismatch=true worker=w-eve-1 gates=[test]
- HOLD-EVIDENCE-MISMATCH on task 01KTTSQ2M71BX6CQRMYNDH6KHF: open
- fleet.worker_frozen events: 1 · registry status: frozen
- w-eve-1 results after freeze: 8647, of which 403 worker_frozen: 8647, completions: 0
-   w-alice-1 completions after the freeze: 242
-   w-bob-1 completions after the freeze: 241
-   w-carol-1 completions after the freeze: 246
-   w-dave-1 completions after the freeze: 248

### idle-zero-credit — PASS

Idle ≥3 loop intervals after drain with ZERO cost.headless_call events
- active workers observed idling: w-alice-1, w-bob-1, w-carol-1, w-dave-1
-   w-alice-1: +3 idle polls in the measured window (614ms)
-   w-bob-1: +3 idle polls in the measured window (614ms)
-   w-carol-1: +3 idle polls in the measured window (614ms)
-   w-dave-1: +3 idle polls in the measured window (614ms)
- cost.headless_call during idle window: 0 · entire soak: 0

### operator-attribution — PASS

Per-operator event attribution: claims/evidence/lifecycle carry registry-bound operatorId + workerId
- executions with fully consistent attribution: 1000/1000
-   operator alice: 246 claim events vs 246 executions
-   operator bob: 245 claim events vs 245 executions
-   operator carol: 251 claim events vs 251 executions
-   operator dave: 253 claim events vs 253 executions
-   operator eve: 5 claim events vs 5 executions

## Honesty note

in-container short soak with simulated executors — validates the harness + protocol under
concurrency; the ≥1-week real-CLI soak on operator machines remains open (rubric #19 stays
unchecked until then).
