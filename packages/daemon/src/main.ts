import { join } from 'path'
import { Daemon } from './daemon.js'
import { resolveAedevHome } from './paths.js'

const AEDEV_HOME = resolveAedevHome()
const schedulerIntervalMs = Number(process.env['AEDEV_SCHEDULER_INTERVAL_MS'] ?? '60000')
const daemon = new Daemon({
  dbPath: join(AEDEV_HOME, 'state.db'),
  port: 7247,
  schedulerIntervalMs: Number.isFinite(schedulerIntervalMs) ? schedulerIntervalMs : 60_000,
})

let stopping = false
async function shutdown(): Promise<void> {
  if (stopping) return
  stopping = true
  // Never let a stuck scheduler sleep hang launchd's SIGTERM — force exit after a grace.
  const watchdog = setTimeout(() => process.exit(0), 3000)
  watchdog.unref()
  try { await daemon.stop() } catch (e) { console.error(e) }
  process.exit(0)
}

async function main() {
  await daemon.start()
  console.log('aedev daemon running on port 7247')
  // Effective cockpit config (point 4). These are read once at process start, so
  // changing any of them requires a daemon RESTART — tsx does not hot-reload the
  // daemon. The dashboard (Vite) hot-reloads the UI separately and needs no restart.
  console.log('[cockpit-config] ' + JSON.stringify({
    db: join(AEDEV_HOME, 'state.db'),
    plannerProvider: process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'auto',
    plannerTimeoutMs: Number(process.env['AEDEV_COCKPIT_AI_TIMEOUT_MS'] ?? '300000'),
    workerTimeoutMs: Number(process.env['AEDEV_COCKPIT_WORKER_TIMEOUT_MS'] ?? '600000'),
    stallMs: Number(process.env['AEDEV_COCKPIT_STALL_MS'] ?? '90000'),
    restartRequiredToChange: true,
  }))
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((e) => { console.error(e); process.exit(1) })
