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
  process.on('SIGTERM', () => void shutdown())
  process.on('SIGINT', () => void shutdown())
}

main().catch((e) => { console.error(e); process.exit(1) })
