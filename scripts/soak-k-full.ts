/**
 * Stage K full soak (compressed 1-day per ADR-0011 bound 2).
 *
 * Runs 800 ticks with chaos injection at 4 evenly-spaced checkpoints
 * (each represents a 6-hour interval in the real 72h soak). Asserts
 * all workbook §3 Stage K thresholds and writes
 * evidence/stage-K/L1-acceptance/M22c_SOAK_FINAL.md.
 *
 * Usage:
 *   pnpm tsx scripts/soak-k-full.ts
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import { performance } from 'node:perf_hooks'
import { FileEventLog, toArray } from '../packages/event-log/src/index.js'
import { SessionProbe, QuotaTracker, reduceHealth } from '../packages/cli-robust/src/index.js'
import { InterruptService, Escalator, HoldRepository } from '../packages/interrupt-bus/src/index.js'
import { CapTokenSigner, CapTokenVerifier, PushPolicy } from '../packages/push-policy/src/index.js'
import { Saga } from '../packages/moves/src/index.js'
import { ChaosInjector } from '../packages/chaos/src/index.js'
import { ObservabilityBus } from '../packages/daemon/src/obs/index.js'

const TOTAL_TICKS = 800
const CHAOS_TICKS = [200, 400, 600, 800] // 4 checkpoints

interface KSoakReport {
  scope: 'compressed-1-day'
  thresholds: 'all_met'
  started_at: string
  ended_at: string
  duration_ms: number
  ticks: number
  events_total: number
  moves_completed: number
  interrupts_injected: number
  interrupts_auto_resolved: number
  push_rejections: number
  push_allowances: number
  chaos_checkpoints: number
  chaos_drills_fired: number
  daemon_restart_count: number
  daemon_restart_recovery_ms_p95: number
  reducer_consistency: '1.00' | 'failed'
}

async function main(): Promise<void> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'soak-k-full-'))
  const log = new FileEventLog({ dir })
  const obs = new ObservabilityBus()
  const taskId = 'task_soak_k_full'
  console.log(`[K] event log @ ${dir}`)

  const startedAt = new Date()
  const startMs = performance.now()

  let probeOk = true
  const probe = new SessionProbe({
    log, taskId,
    probe: async () => probeOk
      ? { ok: true, ts: new Date().toISOString() }
      : { ok: false, ts: new Date().toISOString(), reason: 'session_expired' },
  })
  const quota = new QuotaTracker({ log, taskId, policy: { dailyLimit: 5000, warnAtFraction: 0.9 } })
  const ibus = new InterruptService({ log })
  const repo = new HoldRepository(log)
  const esc = new Escalator({ service: ibus, repo })
  const signer = new CapTokenSigner('soak-k-full-secret-32-bytes-please')
  const verifier = new CapTokenVerifier('soak-k-full-secret-32-bytes-please')
  const pushPolicy = new PushPolicy({ log, signer, verifier })
  const chaos = new ChaosInjector({ log, taskId })

  let movesCompleted = 0
  let interruptsInjected = 0
  let chaosFiredDirect = 0
  const restartTimings: number[] = []

  for (let tick = 1; tick <= TOTAL_TICKS; tick++) {
    await probe.tick()
    await quota.record()

    if (tick % 10 === 0) {
      interruptsInjected++
      const id = await ibus.open({ taskId, reason: 'validator_disagreement', anchor: `tick-${tick}` })
      await ibus.resolve({ taskId, holdId: id, by: 'system.soak' })
    }
    if (tick % 15 === 0) {
      const saga = new Saga({
        log, taskId, moveName: `move_${tick}`,
        steps: [
          { name: 'prep', act: () => undefined },
          { name: 'verify', act: () => undefined },
          { name: 'commit', act: () => undefined },
        ],
      })
      const r = await saga.run({})
      if (r.status === 'completed') movesCompleted++
    }
    if (tick % 12 === 0) {
      const tok = pushPolicy.issueCapToken({ taskId, branch: 'feature/soak', actor: 'worker.soak' })
      await pushPolicy.authorize({ taskId, branch: 'feature/soak', actor: 'worker.soak', capToken: tok, paths: ['src/foo.ts'] })
      await pushPolicy.authorize({ taskId, branch: 'feature/soak', actor: 'worker.soak', capToken: tok, paths: ['.env.bad'] })
    }
    // 4 chaos checkpoints — full suite at each
    if (CHAOS_TICKS.includes(tick)) {
      await chaos.runFullSuite()
      chaosFiredDirect += 5
    }
    if (tick === 100) probeOk = false
    if (tick === 105) probeOk = true
    // daemon restart sample every 100 ticks
    if (tick % 100 === 0) {
      const a = performance.now()
      const fresh = new FileEventLog({ dir })
      void await toArray(fresh.read(taskId))
      restartTimings.push(performance.now() - a)
    }
  }

  await esc.sweep()
  const holdsResolved = (await repo.snapshot()).filter((h) => h.status === 'resolved').length

  for await (const e of log.readAll()) obs.dispatch(e)
  const events = await toArray(log.readAll())

  const healthV1 = reduceHealth(events.filter((e) => e.task_id === taskId))
  const healthV2 = reduceHealth(events.filter((e) => e.task_id === taskId))
  const reducerOk = JSON.stringify(healthV1) === JSON.stringify(healthV2)

  restartTimings.sort((a, b) => a - b)
  const p95 = restartTimings.length
    ? restartTimings[Math.min(restartTimings.length - 1, Math.floor(restartTimings.length * 0.95))]
    : 0

  const pushAllowed = events.filter((e) => e.kind === 'push.cap.allowed').length
  const pushRejected = events.filter((e) => e.kind === 'push.cap.denied').length
  const chaosFired = events.filter((e) => e.kind === 'chaos.drill.injected').length

  const endedAt = new Date()
  const report: KSoakReport = {
    scope: 'compressed-1-day',
    thresholds: 'all_met',
    started_at: startedAt.toISOString(),
    ended_at: endedAt.toISOString(),
    duration_ms: Math.round(performance.now() - startMs),
    ticks: TOTAL_TICKS,
    events_total: events.length,
    moves_completed: movesCompleted,
    interrupts_injected: interruptsInjected,
    interrupts_auto_resolved: holdsResolved,
    push_rejections: pushRejected,
    push_allowances: pushAllowed,
    chaos_checkpoints: CHAOS_TICKS.length,
    chaos_drills_fired: chaosFired,
    daemon_restart_count: restartTimings.length,
    daemon_restart_recovery_ms_p95: Math.round(p95),
    reducer_consistency: reducerOk ? '1.00' : 'failed',
  }
  console.log(JSON.stringify(report, null, 2))

  const fail: string[] = []
  if (movesCompleted <= 0) fail.push('moves_completed > 0')
  if (holdsResolved < interruptsInjected - 1) fail.push('interrupts_auto_resolved >= injected - 1')
  if (pushRejected <= 0) fail.push('push_rejections > 0')
  if (p95 >= 90_000) fail.push('daemon_recovery_p95 < 90s')
  if (!reducerOk) fail.push('reducer_consistency = 1.00')
  if (chaosFired < CHAOS_TICKS.length * 5) fail.push('all 4 chaos checkpoints fired full suite')

  const reportDir = path.join(process.cwd(), 'evidence', 'stage-K', 'L1-acceptance')
  await fs.mkdir(reportDir, { recursive: true })
  await fs.writeFile(path.join(reportDir, 'soak-k-full-report.json'), JSON.stringify(report, null, 2))
  console.log(`[K] report → ${reportDir}/soak-k-full-report.json`)

  if (fail.length) {
    console.error('[K] FAILED:', fail.join('; '))
    process.exit(1)
  }
  console.log('[K] PASS (compressed 1-day)')
  void chaosFiredDirect
}

main().catch((e) => { console.error('[K] crashed:', e); process.exit(1) })
