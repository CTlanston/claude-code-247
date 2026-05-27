import { Command } from 'commander'

const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'

export function registerPreviewCommand(program: Command): void {
  const cmd = program.command('preview').description('External preview deployments')
  cmd
    .command('deploy <id>')
    .description('Deploy preview for a mission (id = mission id or PR ref)')
    .option('--production', 'Deploy production target instead of preview', false)
    .action(async (id: string, opts: { production?: boolean }) => {
      const res = await fetch(`${DAEMON_URL}/missions/${id}/preview-deploy`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ production: Boolean(opts.production) }),
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      const body = await res.json() as Record<string, unknown>
      if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
      console.log(JSON.stringify(body, null, 2))
    })
}
