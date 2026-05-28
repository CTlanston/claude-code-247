import { homedir } from 'os'
import { join } from 'path'

export function resolveAedevHome(env: NodeJS.ProcessEnv = process.env): string {
  return env['AEDEV_HOME'] ?? join(homedir(), '.aedev')
}

export function resolveStateDir(env: NodeJS.ProcessEnv = process.env): string {
  return join(resolveAedevHome(env), 'state')
}
