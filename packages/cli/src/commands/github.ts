import { Command } from 'commander'
const DAEMON_URL = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'

export function registerGitHubCommand(program: Command): void {
  const cmd = program.command('github').description('GitHub collaboration surface')

  cmd.command('sync <missionId>')
    .description('Create a GitHub PR for an approved mission')
    .requiredOption('--owner <owner>', 'GitHub repo owner')
    .requiredOption('--repo <repo>', 'GitHub repo name')
    .option('--base <branch>', 'Base branch', 'main')
    .action(async (missionId: string, opts: { owner: string; repo: string; base: string }) => {
      const res = await fetch(`${DAEMON_URL}/github/sync/${missionId}`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner: opts.owner, repo: opts.repo, defaultBranch: opts.base }),
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      const body = await res.json() as Record<string, unknown>
      if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
      console.log(`PR created: ${body['prUrl']}`)
    })

  cmd.command('import-issue <owner> <repo> <issueNumber>')
    .description('Import a GitHub issue as a mission candidate')
    .action(async (owner: string, repo: string, issueNumber: string) => {
      const res = await fetch(`${DAEMON_URL}/github/import-issue`, {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ owner, repo, issueNumber: parseInt(issueNumber, 10) }),
      }).catch(() => null)
      if (!res) { console.error('daemon not running'); process.exit(1) }
      const body = await res.json() as Record<string, unknown>
      if (!res.ok) { console.error('Error:', body['error']); process.exit(1) }
      console.log(`Mission created: ${body['missionId']}`)
    })
}
