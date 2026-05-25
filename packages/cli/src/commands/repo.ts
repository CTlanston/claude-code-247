import { Command } from 'commander'
import { join } from 'path'
import { homedir } from 'os'
import { existsSync } from 'fs'
import { loadReposYaml } from '@aedev/core'

export function registerRepoCommand(program: Command): void {
  const cmd = program.command('repo').description('Manage repositories')
  cmd.command('list').option('--plain', 'Plain output').action((opts: { plain?: boolean }) => {
    const p = join(process.env['AEDEV_HOME'] ?? join(homedir(), '.aedev'), 'repos.yaml')
    if (!existsSync(p)) { console.log('No repos.yaml found. Run: aedev init'); return }
    const repos = loadReposYaml(p)
    if (repos.length === 0) { console.log('No repos registered.'); return }
    if (opts.plain) {
      for (const r of repos) console.log(`${r.name}\t${r.path}\t${r.enabled ? 'enabled' : 'disabled'}`)
    } else {
      for (const r of repos) console.log(`• ${r.name} (${r.path}) [${r.enabled ? 'enabled' : 'disabled'}]`)
    }
  })
}
