import { Command } from 'commander'

const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'

export function registerBrainstormCommand(program: Command): void {
  program
    .command('brainstorm <idea>')
    .description('Draft a structured PRD/ADR/task-DAG mission from an idea')
    .option('--repo <repoId>', 'Repo id for the mission', 'unknown')
    .action(async (idea: string, opts: { repo: string }) => {
      const res = await fetch(`${DAEMON_URL}/brainstorm`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ idea, repoId: opts.repo }),
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      const body = await res.json() as { missionId?: string; prdPath?: string; error?: string }
      if (!res.ok) { console.error('Error:', body.error); process.exit(1) }
      console.log(`Mission drafted: ${body.missionId}`)
      console.log(`Design + PRD: ${body.prdPath}`)
      console.log(`Review, then run: aedev mission request-approval ${body.missionId}`)
    })
}
