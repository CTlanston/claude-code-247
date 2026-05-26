import { Command } from 'commander'
const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'
export function registerIntakeCommand(program: Command): void {
  program.command('intake <description>').description('Submit a new mission from a raw description').action(async (description: string) => {
    const res = await fetch(`${DAEMON_URL}/intake`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ description }),
    }).catch(() => null)
    if (!res) { console.error('daemon not running'); process.exit(1) }
    const body = await res.json() as { missionId: string; prdPath: string }
    console.log(`Mission created: ${body.missionId}`)
    console.log(`PRD template: ${body.prdPath}`)
    console.log(`\nReview the PRD, then run: aedev mission approve ${body.missionId}`)
  })

}
