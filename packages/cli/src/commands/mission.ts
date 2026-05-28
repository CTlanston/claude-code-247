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

  cmd.command('draft <idea>').description('Alias for brainstorm-style mission drafting').action(async (idea: string) => {
    const res = await fetch(`${DAEMON_URL}/brainstorm`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ idea }),
    }).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const body = await res.json() as Record<string, unknown>
    if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
    console.log(`Mission drafted: ${body['missionId']}`)
    console.log(`Design + PRD: ${body['prdPath']}`)
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

  cmd.command('request-approval <id>').action(async (id: string) => {
    const res = await fetch(`${DAEMON_URL}/missions/${id}/request-approval`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const body = await res.json() as Record<string, unknown>
    if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
    console.log(`Mission ${id} is pending approval`)
  })

  cmd.command('approve <id>').option('--by <operator>', 'Approver identity', 'operator').action(async (id: string, opts: { by: string }) => {
    const req = await fetch(`${DAEMON_URL}/missions/${id}/request-approval`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }).catch(() => null)
    if (!req) { console.error('daemon not running'); process.exit(1) }
    if (!req.ok && req.status !== 400) {
      const body = await req.json() as Record<string, unknown>
      console.error('Error:', body['error']); process.exit(1)
    }
    const res = await fetch(`${DAEMON_URL}/missions/${id}/approve`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ by: opts.by }),
    }).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const body = await res.json() as Record<string, unknown>
    if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
    console.log(`Mission ${id} approved`)
  })

  cmd.command('run <id>').description('Run an approved mission through the aedev spine').action(async (id: string) => {
    const res = await fetch(`${DAEMON_URL}/missions/${id}/run`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const body = await res.json() as Record<string, unknown>
    if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
    console.log(`Mission ${id} run completed: ${body['status']}`)
    console.log(`Evidence: ${body['evidenceDir']}`)
  })
}
