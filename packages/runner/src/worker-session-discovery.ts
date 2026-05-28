import { execFile } from 'child_process'
import { promisify } from 'util'
import type { ModelFamily, ProviderId, WorkerSession } from './worker-pool-router.js'

const execFileAsync = promisify(execFile)

export interface WorkerSessionProbeResult {
  healthy: boolean
  failureReason?: string
}

export interface DiscoverWorkerSessionsOptions {
  env?: NodeJS.ProcessEnv
  now?: () => string
  commandProbe?: (provider: ProviderId, command: string) => Promise<WorkerSessionProbeResult>
  commandAvailable?: (command: string) => Promise<boolean>
}

export async function discoverWorkerSessions(
  opts: DiscoverWorkerSessionsOptions = {},
): Promise<WorkerSession[]> {
  const env = opts.env ?? process.env
  const now = opts.now ?? (() => new Date().toISOString())
  const commandProbe = opts.commandProbe ?? (
    opts.commandAvailable
      ? async (_provider, command) => (await opts.commandAvailable?.(command))
          ? { healthy: true }
          : { healthy: false, failureReason: `${command} is not available` }
      : probeCommand
  )
  const sessions: WorkerSession[] = []

  if (!isDisabled(env, 'AEDEV_DISABLE_CLAUDE_CLI')) {
    const command = env['AEDEV_CLAUDE_BIN'] ?? 'claude'
    sessions.push(makeSession('claude-cli', 'anthropic', await commandProbe('claude-cli', command), now()))
  }
  if (!isDisabled(env, 'AEDEV_DISABLE_CODEX_CLI')) {
    const command = env['AEDEV_CODEX_BIN'] ?? 'codex'
    sessions.push(makeSession('codex-cli', 'openai', await commandProbe('codex-cli', command), now()))
  }
  if (!isDisabled(env, 'AEDEV_DISABLE_GEMINI_API') && hasAnyEnv(env, ['AEDEV_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'])) {
    sessions.push(makeSession('gemini-api', 'google', { healthy: true }, now()))
  }
  if (!isDisabled(env, 'AEDEV_DISABLE_OPENAI_API') && hasAnyEnv(env, ['AEDEV_OPENAI_API_KEY', 'OPENAI_API_KEY'])) {
    sessions.push(makeSession('openai-api', 'openai', { healthy: true }, now()))
  }

  return sessions
}

async function probeCommand(provider: ProviderId, command: string): Promise<WorkerSessionProbeResult> {
  if (!await isCommandAvailable(command)) {
    return { healthy: false, failureReason: `${command} is not available` }
  }
  const args = provider === 'codex-cli' ? ['--version'] : ['--version']
  try {
    await execFileAsync(command, args, { timeout: 10_000 })
    return { healthy: true }
  } catch (error) {
    return { healthy: false, failureReason: `${command} heartbeat failed: ${(error as Error).message}` }
  }
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

function makeSession(
  provider: ProviderId,
  family: ModelFamily,
  probe: WorkerSessionProbeResult,
  lastHeartbeatAt: string,
): WorkerSession {
  const session: WorkerSession = {
    id: provider,
    provider,
    family,
    healthy: probe.healthy,
    active: 0,
    lastHeartbeatAt,
  }
  if (probe.failureReason) session.failureReason = probe.failureReason
  return session
}
