import { Command } from 'commander'

const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'

export function registerReleaseCommand(program: Command): void {
  const cmd = program.command('release').description('Release control (approve / rollback)')

  cmd
    .command('approve <id>')
    .description('Approve a pending release (mission id)')
    .option('--by <operator>', 'Approver identity', 'operator')
    .action(async (id: string, opts: { by: string }) => {
      const res = await fetch(`${DAEMON_URL}/releases/${id}/approve`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ by: opts.by }),
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      const body = await res.json() as Record<string, unknown>
      if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
      console.log(`Release ${id} approved by ${opts.by}`)
    })

  cmd
    .command('rollback <id>')
    .description('Roll back a release by reverting the merge commit')
    .option('--reason <text>', 'Reason recorded in the incident')
    .action(async (id: string, opts: { reason?: string }) => {
      const res = await fetch(`${DAEMON_URL}/releases/${id}/rollback`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ reason: opts.reason ?? 'operator requested' }),
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      const body = await res.json() as Record<string, unknown>
      if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
      console.log(`Release ${id} rolled back${body['revertSha'] ? ` (revert ${String(body['revertSha']).slice(0, 8)})` : ''}`)
    })
}
