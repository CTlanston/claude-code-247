import { Command } from 'commander'

const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'

async function fetchStatus(): Promise<Record<string, unknown> | null> {
  try {
    const res = await fetch(`${DAEMON_URL}/status`)
    return res.ok ? (await res.json() as Record<string, unknown>) : null
  } catch { return null }
}

export function registerDaemonCommand(program: Command): void {
  const cmd = program.command('daemon').description('Manage the aedev daemon process')

  cmd.command('status').option('--plain', 'Plain key=value output').action(async (opts: { plain?: boolean }) => {
    const status = await fetchStatus()
    if (!status) { console.error('daemon not running'); process.exit(1) }
    if (opts.plain) {
      for (const [k, v] of Object.entries(status)) console.log(`${k}=${v}`)
    } else {
      console.log(JSON.stringify(status, null, 2))
    }
  })

  cmd.command('start').description('Start daemon (runs in background via tsx)').action(() => {
    console.log('To start the daemon, run: npx tsx packages/daemon/src/main.ts')
    console.log('(Full daemon lifecycle management will be added in a future phase)')
  })

  cmd.command('stop').description('Stop daemon').action(async () => {
    const status = await fetchStatus()
    if (!status) { console.log('Daemon is not running.'); return }
    console.log('Send SIGTERM to the daemon process to stop it.')
  })
}
