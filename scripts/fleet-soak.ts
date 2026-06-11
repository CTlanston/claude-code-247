/**
 * v5-P4 fleet soak harness (rubric #19 — in-container short soak).
 *
 * Spins the REAL daemon (createServer, :memory: SQLite, temp stateDir, all
 * external CLIs/APIs disabled, remote writes off) and runs FIVE real
 * FleetWorkerAgent loops (operators alice..eve, freshly generated ed25519
 * keypairs, real HTTP over 127.0.0.1) concurrently against the real fleet
 * protocol (/fleet/register|claim|evidence|events|heartbeat).
 *
 * During the soak it:
 *   1. streams claimable tasks into the coordinator and lets the fleet drain them
 *   2. injects the forged-evidence drill: one worker self-reports PASS while
 *      the simulated CI result is FAIL → HOLD-EVIDENCE-MISMATCH + frozen
 *      worker + every later claim 403 worker_frozen, while the other four
 *      keep completing tasks
 *   3. verifies idle-zero-credit: after the queue drains, ≥3 idle polls per
 *      still-active worker append ZERO cost.headless_call events
 *   4. verifies claim-ledger uniqueness: no task is ever executed twice
 *   5. verifies per-operator event attribution (registry-bound identity)
 *
 * Output: evidence/fleet-soak/<timestamp>/soak-report.md (+ metrics.json).
 * Exits non-zero if any criterion FAILs.
 *
 * HONESTY (rubric #19 stays unchecked): this is an in-container short soak
 * with simulated executors — it validates the harness + protocol under
 * concurrency; the ≥1-week real-CLI soak on operator machines remains open.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { AedevDb, generateFleetKeyPairHex, type Task } from '@aedev/core'
import { createServer, detectEvidenceMismatch, type EvidenceMismatchVerdict } from '@aedev/daemon'
import { FleetWorkerAgent, type FleetExecutor, type FleetLoopResult } from '@aedev/runner'

// ---- configuration ---------------------------------------------------------
const SOAK_MS = Number(process.env['AEDEV_SOAK_MS'] ?? '120000')
const INTERVAL_MS = Number(process.env['AEDEV_SOAK_INTERVAL_MS'] ?? '200')
const PORT = Number(process.env['AEDEV_SOAK_PORT'] ?? '0') // 0 = ephemeral
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT_DIR = resolve(process.env['AEDEV_SOAK_DIR'] ?? join(process.cwd(), 'evidence/fleet-soak', STAMP))
const OPERATORS = ['alice', 'bob', 'carol', 'dave', 'eve'] as const
/** The worker that gets the forged-evidence drill injected. */
const DRILL_OPERATOR = 'eve'
const INITIAL_BATCH = 10
const SEED_BATCH = 5
const SEED_EVERY_MS = Math.max(1_000, Math.min(5_000, Math.floor(SOAK_MS / 24)))
/** Stop seeding at 55% of the soak so the drain + idle phases fit inside it. */
const SEED_WINDOW_MS = Math.floor(SOAK_MS * 0.55)
const DRILL_AT_MS = Math.min(15_000, Math.floor(SOAK_MS * 0.25))

// Safety/test env: no external model, no remote writes — same contract as the
// other harnesses. The soak must be reproducible on a machine with no keys.
process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
process.env['AEDEV_DISABLE_CODEX_CLI'] = '1'
process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
process.env['AEDEV_DISABLE_OPENAI_API'] = '1'
process.env['AEDEV_COCKPIT_FORCE_MOCK'] = '1'
process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '1'

// ---- state -----------------------------------------------------------------
interface TimedResult { at: number; result: FleetLoopResult }
interface WorkerHandle {
  workerId: string
  operatorId: string
  agent: FleetWorkerAgent
  results: TimedResult[]
  registered: boolean
}
interface ExecutionRecord { taskId: string; workerId: string; operatorId: string; at: number }
interface Criterion { id: string; title: string; pass: boolean; details: string[] }

const stateDir = mkdtempSync(join(tmpdir(), 'aedev-fleet-soak-'))
const db = new AedevDb(':memory:')
const daemon = createServer(db, new Date(), stateDir)

const workers: WorkerHandle[] = []
const executions: ExecutionRecord[] = []
const seededIds: string[] = []
const criteria: Criterion[] = []

const drill: {
  armed: boolean
  taskId?: string
  workerId?: string
  verdict?: EvidenceMismatchVerdict
  freezeAtMs?: number
  /** eve's results length at freeze time — everything after must be 403. */
  freezeResultIndex?: number
} = { armed: false }

let drainOk = false
let drainMs = 0
let idlePollsOk = false
let idleWindowMs = 0
let idleBaseline: Record<string, number> = {}
let idleAtWindowEnd: Record<string, number> = {}
let idleActiveWorkerIds: string[] = []
let headlessAtIdleStart = 0
let headlessAtIdleEnd = 0
let startMs = 0
let endMs = 0
let harnessError: string | undefined

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))
const countHeadless = () => db.queryEvents({ type: 'cost.headless_call' }).length
const idleCount = (w: WorkerHandle) => w.results.filter((r) => r.result.status === 'idle').length

async function waitFor(cond: () => boolean, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (cond()) return true
    await sleep(100)
  }
  return cond()
}

// ---- task stream -----------------------------------------------------------
let missionId = ''
let repoId = ''
let taskSeq = 0

function seedTasks(count: number): void {
  for (let i = 0; i < count; i++) {
    const t = db.insertTask({
      missionId, repoId, title: `soak-t${taskSeq}`, prompt: `simulated soak task ${taskSeq}`,
      status: 'pending', attemptNumber: 0,
    })
    seededIds.push(t.id)
    taskSeq++
  }
}

// ---- worker wiring ----------------------------------------------------------
function makeExecutor(workerId: string, operatorId: string): FleetExecutor {
  return async (task: Task) => {
    // Simulated implementation work: a short jitter so the five loops
    // genuinely interleave, then PASSING evidence. No subprocess, no CLI.
    await sleep(30 + Math.floor(Math.random() * 60))
    executions.push({ taskId: task.id, workerId, operatorId, at: Date.now() })
    return {
      exitCode: 0,
      evidence: { 'test-summary.md': `task ${task.id} (${task.title}) executed by ${workerId}: simulated gates green` },
      gates: { test: true, lint: true },
    }
  }
}

function onWorkerResult(w: WorkerHandle, result: FleetLoopResult): void {
  w.results.push({ at: Date.now(), result })
  if (result.status !== 'completed') return
  if (w.operatorId === DRILL_OPERATOR && drill.armed && drill.taskId === undefined) {
    // FORGED-EVIDENCE DRILL: eve just self-reported PASS for this task; the
    // simulated CI-on-PR result lands as FAIL. The harness plays the CI side
    // (in production this fires when the real CI check completes).
    drill.taskId = result.taskId
    drill.workerId = w.workerId
    drill.freezeResultIndex = w.results.length
    db.updateTaskStatus(result.taskId, 'failed') // CI failed → not re-claimable
    drill.verdict = detectEvidenceMismatch(db, result.taskId, { gates: { test: false, lint: true } })
    drill.freezeAtMs = Date.now()
    console.log(`[soak] drill injected: ${w.workerId} task ${result.taskId} → mismatch=${drill.verdict.mismatch}`)
    return
  }
  // Simulated coordinator/CI completion: matching CI result, task is done.
  db.updateTaskStatus(result.taskId, 'done')
}

// ---- main -------------------------------------------------------------------
void main()

async function main(): Promise<void> {
  let loops: Promise<void>[] = []
  let stopAll: (() => void) | undefined
  let progressTimer: ReturnType<typeof setInterval> | undefined
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    const repo = db.insertRepo({
      name: 'fleet-soak-repo', path: stateDir, defaultBranch: 'main', enabled: true,
      testCommands: [], forbiddenPaths: ['.env*', 'secrets/**', '.github/**'], riskRules: {}, mergePolicy: 'WAITING',
    })
    repoId = repo.id
    missionId = db.insertMission({ repoId, title: 'fleet soak mission', status: 'approved' }).id

    const baseUrl = await daemon.listen({ port: PORT, host: '127.0.0.1' })
    console.log(`[soak] coordinator on ${baseUrl} · soak ${SOAK_MS}ms · interval ${INTERVAL_MS}ms`)

    // Provision 5 workers with real generated keypairs and register them all.
    for (const operatorId of OPERATORS) {
      const keys = generateFleetKeyPairHex()
      const workerId = `w-${operatorId}-1`
      const handle: WorkerHandle = {
        workerId, operatorId, results: [], registered: false,
        agent: new FleetWorkerAgent({
          baseUrl, workerId, operatorId,
          privateKeyHex: keys.privateKeyHex, publicKeyHex: keys.publicKeyHex,
          executor: makeExecutor(workerId, operatorId),
        }),
      }
      const reg = await handle.agent.register()
      handle.registered = reg.ok
      if (!reg.ok) throw new Error(`register failed for ${workerId}: HTTP ${reg.httpStatus} ${reg.code ?? ''}`)
      workers.push(handle)
    }
    console.log(`[soak] registered ${workers.length} workers: ${workers.map((w) => w.workerId).join(', ')}`)

    // Start all 5 loops concurrently.
    startMs = Date.now()
    let stop!: () => void
    const stopSignal = new Promise<void>((r) => { stop = r })
    stopAll = stop
    loops = workers.map((w) => w.agent.runLoop({
      intervalMs: INTERVAL_MS, stopSignal, onResult: (r) => onWorkerResult(w, r),
    }))
    progressTimer = setInterval(() => {
      const done = db.listTasks().filter((t) => t.status === 'done' || t.status === 'failed').length
      console.log(`[soak] t+${Math.round((Date.now() - startMs) / 1000)}s · seeded=${seededIds.length} finished=${done} executions=${executions.length} headless=${countHeadless()}`)
    }, 10_000)

    // Arm the forged-evidence drill partway in.
    const drillTimer = setTimeout(() => { drill.armed = true; console.log('[soak] drill armed') }, DRILL_AT_MS)

    // Phase 1 — stream claimable tasks.
    seedTasks(INITIAL_BATCH)
    while (Date.now() - startMs < SEED_WINDOW_MS) {
      await sleep(Math.min(SEED_EVERY_MS, Math.max(0, SEED_WINDOW_MS - (Date.now() - startMs))))
      if (Date.now() - startMs < SEED_WINDOW_MS) seedTasks(SEED_BATCH)
    }
    console.log(`[soak] seeding finished: ${seededIds.length} tasks`)

    // The drill must have fired by now (eve completes tasks every ~250ms).
    await waitFor(() => drill.taskId !== undefined, 30_000)
    clearTimeout(drillTimer)

    // Phase 2 — drain: every seeded task leaves 'pending'.
    drainOk = await waitFor(() => db.listTasks().every((t) => t.status !== 'pending'), 30_000)
    drainMs = Date.now() - startMs
    console.log(`[soak] drain ${drainOk ? 'complete' : 'INCOMPLETE'} at t+${Math.round(drainMs / 1000)}s`)

    // Phase 3 — idle-zero-credit: every still-active worker idles ≥3 polls;
    // no cost.headless_call event may appear while the fleet is idle.
    idleActiveWorkerIds = workers
      .filter((w) => db.getFleetWorker(w.workerId)?.status === 'active')
      .map((w) => w.workerId)
    idleBaseline = Object.fromEntries(workers.map((w) => [w.workerId, idleCount(w)]))
    headlessAtIdleStart = countHeadless()
    const idleStartMs = Date.now()
    idlePollsOk = await waitFor(
      () => workers
        .filter((w) => idleActiveWorkerIds.includes(w.workerId))
        .every((w) => idleCount(w) - (idleBaseline[w.workerId] ?? 0) >= 3),
      30_000,
    )
    headlessAtIdleEnd = countHeadless()
    idleAtWindowEnd = Object.fromEntries(workers.map((w) => [w.workerId, idleCount(w)]))
    idleWindowMs = Date.now() - idleStartMs
    console.log(`[soak] idle window ${idleWindowMs}ms · headless ${headlessAtIdleStart}→${headlessAtIdleEnd}`)

    // Phase 4 — keep the loops idling until the configured duration elapses.
    const remaining = SOAK_MS - (Date.now() - startMs)
    if (remaining > 0) await sleep(remaining)
  } catch (e) {
    harnessError = (e as Error).stack ?? String(e)
    console.error('[soak] harness error:', e)
  } finally {
    if (progressTimer) clearInterval(progressTimer)
    stopAll?.()
    await Promise.all(loops).catch(() => undefined)
    endMs = Date.now()
    evaluateCriteria()
    writeReport()
    await daemon.close().catch(() => undefined)
    db.close()
    rmSync(stateDir, { recursive: true, force: true })
  }
}

// ---- criteria ---------------------------------------------------------------
function evaluate(id: string, title: string, fn: (details: string[]) => boolean): void {
  const details: string[] = []
  let pass = false
  try {
    pass = fn(details)
  } catch (e) {
    details.push(`ERROR: ${(e as Error).message}`)
  }
  criteria.push({ id, title, pass, details })
}

function evaluateCriteria(): void {
  const eve = workers.find((w) => w.operatorId === DRILL_OPERATOR)
  const others = workers.filter((w) => w.operatorId !== DRILL_OPERATOR)

  evaluate('provisioning', '5 workers (5 operators) registered with real ed25519 keypairs', (d) => {
    d.push(`registered: ${workers.filter((w) => w.registered).length}/5`)
    const keys = new Set(workers.map((w) => db.getFleetWorker(w.workerId)?.publicKey ?? ''))
    d.push(`distinct public keys in registry: ${keys.size}`)
    return workers.length === 5 && workers.every((w) => w.registered) && keys.size === 5 && !keys.has('')
  })

  evaluate('no-double-execution', 'Claim-ledger uniqueness: every task executed exactly once across 5 workers', (d) => {
    const byTask = new Map<string, ExecutionRecord[]>()
    for (const e of executions) byTask.set(e.taskId, [...(byTask.get(e.taskId) ?? []), e])
    const doubled = [...byTask.entries()].filter(([, e]) => e.length > 1)
    const unexecuted = seededIds.filter((id) => !byTask.has(id))
    const multiClaim = seededIds.filter((id) => db.queryEvents({ type: 'fleet.task_claimed', entityId: id }).length !== 1)
    d.push(`tasks seeded: ${seededIds.length} · executions: ${executions.length}`)
    d.push(`executed twice: ${doubled.length} · never executed: ${unexecuted.length} · with ≠1 claim event: ${multiClaim.length}`)
    d.push(`queue drained inside the soak: ${drainOk} (t+${Math.round(drainMs / 1000)}s)`)
    for (const w of workers) {
      d.push(`  ${w.workerId} (${w.operatorId}): ${executions.filter((e) => e.workerId === w.workerId).length} tasks executed`)
    }
    return drainOk && seededIds.length > 0 && doubled.length === 0 && unexecuted.length === 0
      && multiClaim.length === 0 && executions.length === seededIds.length
  })

  evaluate('forged-evidence-drill', 'Drill: self-reported PASS vs simulated-CI FAIL → HOLD + freeze + later claims 403; other 4 keep working', (d) => {
    if (!eve || drill.taskId === undefined || drill.freezeResultIndex === undefined || drill.freezeAtMs === undefined) {
      d.push('drill never fired')
      return false
    }
    const verdictOk = drill.verdict?.mismatch === true && drill.verdict.workerId === eve.workerId
      && (drill.verdict.mismatchedGates ?? []).includes('test')
    d.push(`verdict: mismatch=${drill.verdict?.mismatch} worker=${drill.verdict?.workerId} gates=[${drill.verdict?.mismatchedGates.join(', ')}]`)
    const hold = db.listActiveHolds(drill.taskId).find((h) => h.code === 'HOLD-EVIDENCE-MISMATCH')
    d.push(`HOLD-EVIDENCE-MISMATCH on task ${drill.taskId}: ${hold ? 'open' : 'MISSING'}`)
    const frozenEvent = db.queryEvents({ type: 'fleet.worker_frozen', entityId: eve.workerId }).length
    const status = db.getFleetWorker(eve.workerId)?.status
    d.push(`fleet.worker_frozen events: ${frozenEvent} · registry status: ${status}`)
    const post = eve.results.slice(drill.freezeResultIndex)
    const frozen403 = post.filter((r) => r.result.status === 'refused' && r.result.httpStatus === 403 && r.result.code === 'worker_frozen')
    d.push(`${eve.workerId} results after freeze: ${post.length}, of which 403 worker_frozen: ${frozen403.length}, completions: ${post.filter((r) => r.result.status === 'completed').length}`)
    const survivors = others.map((w) => ({
      workerId: w.workerId,
      after: w.results.filter((r) => r.at > (drill.freezeAtMs ?? 0) && r.result.status === 'completed').length,
    }))
    for (const s of survivors) d.push(`  ${s.workerId} completions after the freeze: ${s.after}`)
    return verdictOk && hold !== undefined && frozenEvent === 1 && status === 'frozen'
      && post.length >= 3 && frozen403.length === post.length
      && survivors.every((s) => s.after >= 1)
  })

  evaluate('idle-zero-credit', 'Idle ≥3 loop intervals after drain with ZERO cost.headless_call events', (d) => {
    d.push(`active workers observed idling: ${idleActiveWorkerIds.join(', ') || '(none)'}`)
    const windowDeltas = workers
      .filter((x) => idleActiveWorkerIds.includes(x.workerId))
      .map((w) => ({ workerId: w.workerId, delta: (idleAtWindowEnd[w.workerId] ?? 0) - (idleBaseline[w.workerId] ?? 0) }))
    for (const { workerId, delta } of windowDeltas) {
      d.push(`  ${workerId}: +${delta} idle polls in the measured window (${idleWindowMs}ms)`)
    }
    const idleDelta = headlessAtIdleEnd - headlessAtIdleStart
    const total = countHeadless()
    d.push(`cost.headless_call during idle window: ${idleDelta} · entire soak: ${total}`)
    return idlePollsOk && idleActiveWorkerIds.length === 4
      && windowDeltas.every((x) => x.delta >= 3) && idleDelta === 0 && total === 0
  })

  evaluate('operator-attribution', 'Per-operator event attribution: claims/evidence/lifecycle carry registry-bound operatorId + workerId', (d) => {
    let bad = 0
    for (const e of executions) {
      const claim = db.queryEvents({ type: 'fleet.task_claimed', entityId: e.taskId })
      const evidence = db.queryEvents({ type: 'fleet.evidence_reported', entityId: e.taskId })
      const started = db.queryEvents({ type: 'worker.task_started', entityId: e.taskId })
      const finished = db.queryEvents({ type: 'worker.task_finished', entityId: e.taskId })
      const rows = [...claim, ...evidence, ...started, ...finished]
      if (claim.length !== 1 || evidence.length !== 1 || started.length !== 1 || finished.length !== 1) bad++
      else if (!rows.every((r) => r.operatorId === e.operatorId && r.payload['workerId'] === e.workerId)) bad++
    }
    d.push(`executions with fully consistent attribution: ${executions.length - bad}/${executions.length}`)
    for (const w of workers) {
      const claims = db.queryEvents({ type: 'fleet.task_claimed', operatorId: w.operatorId }).length
      const mine = executions.filter((e) => e.operatorId === w.operatorId).length
      d.push(`  operator ${w.operatorId}: ${claims} claim events vs ${mine} executions`)
      if (claims !== mine) bad++
    }
    return executions.length > 0 && bad === 0
  })

  if (harnessError) {
    criteria.push({ id: 'harness', title: 'Harness completed without errors', pass: false, details: [harnessError.split('\n')[0] ?? 'error'] })
  }
}

// ---- report -----------------------------------------------------------------
function writeReport(): void {
  const overall = criteria.length > 0 && criteria.every((c) => c.pass) ? 'PASS' : 'FAIL'
  if (overall === 'FAIL') process.exitCode = 1
  const durationS = Math.round((endMs - startMs) / 1000)
  const lines: string[] = [
    '# Fleet Soak Report — v5-P4 (in-container short soak)',
    '',
    `Result: **${overall}**`,
    `Timestamp: ${STAMP}`,
    `Duration: ${durationS}s (AEDEV_SOAK_MS=${SOAK_MS}, intervalMs=${INTERVAL_MS})`,
    `Evidence dir: ${OUT_DIR}`,
    '',
    'Harness: real daemon (createServer, :memory: SQLite, temp stateDir), remote writes disabled,',
    'all external CLIs/APIs disabled, 5 real FleetWorkerAgent loops over real HTTP on 127.0.0.1,',
    'simulated executors producing passing evidence, simulated CI landing for each completion.',
    '',
    '## Workers',
    '',
    '| worker | operator | tasks executed | final registry status |',
    '|--------|----------|----------------|------------------------|',
    ...workers.map((w) => {
      const status = drill.workerId === w.workerId ? 'frozen (drill)' : 'active'
      return `| ${w.workerId} | ${w.operatorId} | ${executions.filter((e) => e.workerId === w.workerId).length} | ${status} |`
    }),
    '',
    `Tasks seeded: ${seededIds.length} · executed: ${executions.length} · drill task: ${drill.taskId ?? 'n/a'}`,
    '',
    '## Criteria',
    '',
  ]
  for (const c of criteria) {
    lines.push(`### ${c.id} — ${c.pass ? 'PASS' : 'FAIL'}`)
    lines.push('')
    lines.push(c.title)
    for (const d of c.details) lines.push(`- ${d}`)
    lines.push('')
  }
  lines.push(
    '## Honesty note',
    '',
    'in-container short soak with simulated executors — validates the harness + protocol under',
    'concurrency; the ≥1-week real-CLI soak on operator machines remains open (rubric #19 stays',
    'unchecked until then).',
    '',
  )
  writeFileSync(join(OUT_DIR, 'soak-report.md'), lines.join('\n'))
  writeFileSync(join(OUT_DIR, 'metrics.json'), JSON.stringify({
    overall, soakMs: SOAK_MS, intervalMs: INTERVAL_MS, durationMs: endMs - startMs,
    tasksSeeded: seededIds.length, executions: executions.length,
    executionsPerWorker: Object.fromEntries(workers.map((w) => [w.workerId, executions.filter((e) => e.workerId === w.workerId).length])),
    drill: { taskId: drill.taskId, workerId: drill.workerId, verdict: drill.verdict, freezeAtMs: drill.freezeAtMs },
    idle: { idlePollsOk, idleWindowMs, headlessAtIdleStart, headlessAtIdleEnd, headlessTotal: countHeadless() },
    criteria: criteria.map((c) => ({ id: c.id, pass: c.pass })),
    harnessError: harnessError ?? null,
  }, null, 2))
  console.log(`\nFleet soak ${overall} — evidence in ${OUT_DIR}`)
  for (const c of criteria) console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.id} — ${c.title}`)
}
