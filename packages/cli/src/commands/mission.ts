import { Command } from 'commander'

const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'

export function registerMissionCommand(program: Command): void {
  const cmd = program.command('mission').description('Manage missions')
  cmd.command('list').action(async () => {
    const res = await fetch(`${DAEMON_URL}/missions`).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const { missions } = await res.json() as { missions: unknown[] }
    if (missions.length === 0) { console.log('No missions.'); return }
    for (const m of missions) console.log(JSON.stringify(m))
  })
  for (const action of ['pause', 'resume', 'cancel'] as const) {
    cmd.command(`${action} <id>`).action(async (id: string) => {
      const statusMap = { pause: 'paused', resume: 'running', cancel: 'cancelled' } as const
      const res = await fetch(`${DAEMON_URL}/missions/${id}/status`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status: statusMap[action] }),
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      console.log(res.ok ? `Mission ${action}d` : `Error: ${res.status}`)
    })
  }
}
