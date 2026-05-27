import { Command } from 'commander'

const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'

export function registerSecretsCommand(program: Command): void {
  const cmd = program.command('secrets').description('Temporary, per-task per-repo secret grants')

  cmd
    .command('grant <repo> <secret>')
    .description('Grant a secret to a repo for a bounded TTL — never broad-access')
    .option('--task <id>', 'Bind grant to a task id')
    .option('--ttl <minutes>', 'Time to live in minutes', '60')
    .option('--note <text>', 'Reason recorded in the audit log')
    .action(async (repo: string, secret: string, opts: { task?: string; ttl: string; note?: string }) => {
      const ttlMinutes = Number(opts.ttl)
      if (!Number.isFinite(ttlMinutes) || ttlMinutes <= 0) {
        console.error('--ttl must be a positive number of minutes')
        process.exit(1)
      }
      const res = await fetch(`${DAEMON_URL}/secrets/grant`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          repo,
          secretName: secret,
          ttlMinutes,
          ...(opts.task !== undefined ? { taskId: opts.task } : {}),
          ...(opts.note !== undefined ? { note: opts.note } : {}),
        }),
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      const body = await res.json() as Record<string, unknown>
      if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
      console.log(`Granted ${secret} → ${repo} for ${ttlMinutes}min${opts.task ? ` (task ${opts.task})` : ''}`)
      console.log(`Expires at: ${body['expiresAt']}`)
    })

  cmd
    .command('list')
    .description('List active secret grants')
    .action(async () => {
      const res = await fetch(`${DAEMON_URL}/secrets/grants`).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      const body = await res.json() as { grants?: unknown[] }
      const grants = body.grants ?? []
      if (grants.length === 0) { console.log('No active grants.'); return }
      for (const g of grants) console.log(JSON.stringify(g))
    })

  cmd
    .command('revoke <id>')
    .description('Revoke an active grant before its TTL')
    .action(async (id: string) => {
      const res = await fetch(`${DAEMON_URL}/secrets/grants/${id}/revoke`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{}',
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      console.log(res.ok ? `Grant ${id} revoked` : `Error: ${res.status}`)
    })
}
