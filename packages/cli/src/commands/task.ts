import { Command } from 'commander'
const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'
export function registerTaskCommand(program: Command): void {
  const cmd = program.command('task').description('Manage tasks')
  cmd.command('list').action(async () => {
    const res = await fetch(`${DAEMON_URL}/tasks`).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const { tasks } = await res.json() as { tasks: unknown[] }
    if (tasks.length === 0) { console.log('No tasks.'); return }
    for (const t of tasks) console.log(JSON.stringify(t))
  })
  cmd.command('view <id>').action(async (id: string) => {
    const res = await fetch(`${DAEMON_URL}/tasks/${id}`).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    if (res.status === 404) { console.log('Task not found'); return }
    console.log(JSON.stringify(await res.json(), null, 2))
  })
  cmd.command('replay <id>').description('Re-enqueue a task to be retried by the runner').action(async (id: string) => {
    const res = await fetch(`${DAEMON_URL}/tasks/${id}/replay`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}',
    }).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const body = await res.json() as Record<string, unknown>
    if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
    console.log(`Task ${id} replay queued${body['newRunId'] ? ` (run ${body['newRunId']})` : ''}`)
  })
}
