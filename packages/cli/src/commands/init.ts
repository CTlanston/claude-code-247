import { Command } from 'commander'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const DEFAULT_REPOS_YAML = `# aedev repo registry
# Each entry defines a repository managed by aedev.
# Example:
# - name: my-app
#   path: /Users/you/projects/my-app
#   githubOwner: acme
#   githubRepo: my-app
#   defaultBranch: main
#   testCommands:
#     - pnpm test
`

const DEFAULT_CONFIG_YAML = `# aedev system configuration
system:
  allow_remote_writes: false
  auth_mode: local_claude_code
  max_concurrent_workers: 2
`

export function registerInitCommand(program: Command): void {
  program.command('init').description('Initialize aedev home directory (~/.aedev/)').action(() => {
    const home = process.env['AEDEV_HOME'] ?? join(homedir(), '.aedev')
    const dirs = [home, join(home, 'state'), join(home, 'evidence'), join(home, 'logs'),
      join(home, 'prd'), join(home, 'adr'), join(home, 'roadmaps'), join(home, 'memory')]
    for (const d of dirs) mkdirSync(d, { recursive: true })
    const reposPath = join(home, 'repos.yaml')
    if (!existsSync(reposPath)) writeFileSync(reposPath, DEFAULT_REPOS_YAML)
    const configPath = join(home, 'config.yaml')
    if (!existsSync(configPath)) writeFileSync(configPath, DEFAULT_CONFIG_YAML)
    console.log(`aedev initialized at ${home}`)
  })
}
