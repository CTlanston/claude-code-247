import { homedir } from 'os'
import { join } from 'path'
import { Daemon } from './daemon.js'

const AEDEV_HOME = process.env['AEDEV_HOME'] ?? join(homedir(), '.aedev')
const daemon = new Daemon({ dbPath: join(AEDEV_HOME, 'state.db'), port: 7247 })

async function main() {
  await daemon.start()
  console.log('aedev daemon running on port 7247')
  process.on('SIGTERM', async () => { await daemon.stop(); process.exit(0) })
  process.on('SIGINT', async () => { await daemon.stop(); process.exit(0) })
}

main().catch((e) => { console.error(e); process.exit(1) })
