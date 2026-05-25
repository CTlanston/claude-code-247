import { Command } from 'commander'
const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'
export function registerStatusCommand(program: Command): void {
  program.command('status').option('--plain', 'Plain output').action(async (opts: { plain?: boolean }) => {
    const res = await fetch(`${DAEMON_URL}/status`).catch(() => null)
    if (!res) {
      console.log(opts.plain ? 'daemon_running=false' : 'Daemon: not running')
      return
    }
    const s = await res.json() as Record<string, unknown>
    if (opts.plain) { for (const [k, v] of Object.entries(s)) console.log(`${k}=${v}`) }
    else console.log(JSON.stringify(s, null, 2))
  })
}
