import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ModelFamily, ProviderId, WorkerSession } from './worker-pool-router.js'

const execFileAsync = promisify(execFile)

export interface DiscoverWorkerSessionsOptions {
  env?: NodeJS.ProcessEnv
  commandAvailable?: (command: string) => Promise<boolean>
}

export async function discoverWorkerSessions(
  opts: DiscoverWorkerSessionsOptions = {},
): Promise<WorkerSession[]> {
  const env = opts.env ?? process.env
  const commandAvailable = opts.commandAvailable ?? isCommandAvailable
  const sessions: WorkerSession[] = []

  if (!isDisabled(env, 'AEDEV_DISABLE_CLAUDE_CLI') && await commandAvailable(env['AEDEV_CLAUDE_BIN'] ?? 'claude')) {
    sessions.push(makeSession('claude-cli', 'anthropic'))
  }
  if (!isDisabled(env, 'AEDEV_DISABLE_CODEX_CLI') && await commandAvailable(env['AEDEV_CODEX_BIN'] ?? 'codex')) {
    sessions.push(makeSession('codex-cli', 'openai'))
  }
  if (!isDisabled(env, 'AEDEV_DISABLE_GEMINI_API') && hasAnyEnv(env, ['AEDEV_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'])) {
    sessions.push(makeSession('gemini-api', 'google'))
  }
  if (!isDisabled(env, 'AEDEV_DISABLE_OPENAI_API') && hasAnyEnv(env, ['AEDEV_OPENAI_API_KEY', 'OPENAI_API_KEY'])) {
    sessions.push(makeSession('openai-api', 'openai'))
  }

  return sessions
}

async function isCommandAvailable(command: string): Promise<boolean> {
  const probe = process.platform === 'win32' ? 'where' : 'which'
  try {
    await execFileAsync(probe, [command], { timeout: 5000 })
    return true
  } catch {
    return false
  }
}

function hasAnyEnv(env: NodeJS.ProcessEnv, keys: string[]): boolean {
  return keys.some((key) => Boolean(env[key]?.trim()))
}

function isDisabled(env: NodeJS.ProcessEnv, key: string): boolean {
  return /^(1|true|yes)$/i.test(env[key] ?? '')
}

function makeSession(provider: ProviderId, family: ModelFamily): WorkerSession {
  return {
    id: provider,
    provider,
    family,
    healthy: true,
    active: 0,
  }
}
