import { Command } from 'commander'
const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'

export function registerMemoryCommand(program: Command): void {
  const cmd = program.command('memory').description('Manage long-term memory')

  cmd.command('list').option('--approved', 'Only approved items').action(async (opts: { approved?: boolean }) => {
    const url = `${DAEMON_URL}/memory${opts.approved ? '?approved=true' : ''}`
    const res = await fetch(url).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const { items } = await res.json() as { items: unknown[] }
    if (items.length === 0) { console.log('No memory items.'); return }
    for (const item of items) console.log(JSON.stringify(item))
  })

  cmd.command('approve <id>').action(async (id: string) => {
    const res = await fetch(`${DAEMON_URL}/memory/${id}/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    console.log(res.ok ? `Memory item ${id} approved` : `Error: ${res.status}`)
  })

  cmd.command('scan').description('Scan failed runs and create memory candidates').action(async () => {
    const res = await fetch(`${DAEMON_URL}/memory/scan`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const body = await res.json() as { created: number }
    console.log(`Created ${body.created} memory candidates.`)
  })
}
