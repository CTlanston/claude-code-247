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

async function main() {
  await daemon.start()
  console.log('aedev daemon running on port 7247')
  process.on('SIGTERM', async () => { await daemon.stop(); process.exit(0) })
  process.on('SIGINT', async () => { await daemon.stop(); process.exit(0) })
}

main().catch((e) => { console.error(e); process.exit(1) })
