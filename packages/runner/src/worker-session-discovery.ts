import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import type { ModelFamily, ProviderId, WorkerSession } from './worker-pool-router.js'

const execFileAsync = promisify(execFile)

export interface DiscoverWorkerSessionsOptions {
  env?: NodeJS.ProcessEnv
  commandAvailable?: (command: string) => Promise<boolean>
  probeSessions?: boolean
  probeTimeoutMs?: number
  runProbe?: (provider: ProviderId, command: string, env: NodeJS.ProcessEnv, timeoutMs: number) => Promise<ProbeResult>
}

export interface ProbeResult {
  ok: boolean
  error?: string
}

export async function discoverWorkerSessions(
  opts: DiscoverWorkerSessionsOptions = {},
): Promise<WorkerSession[]> {
  const env = opts.env ?? process.env
  const commandAvailable = opts.commandAvailable ?? isCommandAvailable
  const probeSessions = opts.probeSessions ?? true
  const probeTimeoutMs = opts.probeTimeoutMs ?? 15_000
  const runProbe = opts.runProbe ?? probeWorkerSession
  const sessions: WorkerSession[] = []

  const claudeBin = env['AEDEV_CLAUDE_BIN'] ?? 'claude'
  if (!isDisabled(env, 'AEDEV_DISABLE_CLAUDE_CLI') && await commandAvailable(claudeBin)) {
    sessions.push(await makeCliSession('claude-cli', 'anthropic', claudeBin, env, probeSessions, probeTimeoutMs, runProbe))
  }
  const codexBin = env['AEDEV_CODEX_BIN'] ?? 'codex'
  if (!isDisabled(env, 'AEDEV_DISABLE_CODEX_CLI') && await commandAvailable(codexBin)) {
    sessions.push(await makeCliSession('codex-cli', 'openai', codexBin, env, probeSessions, probeTimeoutMs, runProbe))
  }
  if (!isDisabled(env, 'AEDEV_DISABLE_GEMINI_API') && hasAnyEnv(env, ['AEDEV_GEMINI_API_KEY', 'GEMINI_API_KEY', 'GOOGLE_API_KEY'])) {
    sessions.push(makeSession('gemini-api', 'google', true, 'skipped'))
  }
  if (!isDisabled(env, 'AEDEV_DISABLE_OPENAI_API') && hasAnyEnv(env, ['AEDEV_OPENAI_API_KEY', 'OPENAI_API_KEY'])) {
    sessions.push(makeSession('openai-api', 'openai', true, 'skipped'))
  }

  return sessions
}

export async function probeWorkerSession(
  provider: ProviderId,
  command: string,
  env: NodeJS.ProcessEnv = process.env,
  timeoutMs = 15_000,
): Promise<ProbeResult> {
  if (provider === 'codex-cli') {
    return spawnProbe({
      command,
      args: ['exec', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '--json', '--ephemeral', '--skip-git-repo-check', '-'],
      stdin: 'Reply with OK only.',
      env,
      timeoutMs,
    })
  }
  if (provider === 'claude-cli') {
    const localEnv = { ...env }
    delete localEnv['ANTHROPIC_API_KEY']
    delete localEnv['ANTHROPIC_BASE_URL']
    delete localEnv['ANTHROPIC_AUTH_TOKEN']
    delete localEnv['ANTHROPIC_API_URL']
    return spawnProbe({
      command,
      args: ['--print', '--output-format', 'json', '--append-system-prompt', '', '--permission-mode', 'bypassPermissions'],
      stdin: 'Reply with OK only.',
      env: localEnv,
      timeoutMs,
    })
  }
  return { ok: true }
}

async function makeCliSession(
  provider: ProviderId,
  family: ModelFamily,
  command: string,
  env: NodeJS.ProcessEnv,
  probeSessions: boolean,
  probeTimeoutMs: number,
  runProbe: NonNullable<DiscoverWorkerSessionsOptions['runProbe']>,
): Promise<WorkerSession> {
  if (!probeSessions) return makeSession(provider, family, true, 'skipped')
  const result = await runProbe(provider, command, env, probeTimeoutMs)
  return makeSession(provider, family, result.ok, result.ok ? 'ok' : 'failed', result.error)
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

function makeSession(provider: ProviderId, family: ModelFamily, healthy: boolean, probeStatus: WorkerSession['probeStatus'], probeError?: string): WorkerSession {
  return {
    id: provider,
    provider,
    family,
    healthy,
    active: 0,
    probeStatus,
    ...(probeError ? { probeError } : {}),
    probedAt: new Date().toISOString(),
  }
}

function spawnProbe(opts: {
  command: string
  args: string[]
  stdin: string
  env: NodeJS.ProcessEnv
  timeoutMs: number
}): Promise<ProbeResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    let timedOut = false
    const child = spawn(opts.command, opts.args, {
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    const timer = setTimeout(() => {
      timedOut = true
      try { child.kill('SIGTERM') } catch { /* already gone */ }
    }, opts.timeoutMs)
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    // A broken/fast-exiting CLI probe can close stdin before we finish writing;
    // swallow the resulting EPIPE (the real outcome is the exit code).
    child.stdin?.on('error', () => {})
    child.stdin?.write(opts.stdin)
    child.stdin?.end()
    const settle = (result: ProbeResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }
    child.on('error', (err) => settle({ ok: false, error: `spawn failed: ${err.message}` }))
    child.on('close', (code) => {
      if (timedOut) return settle({ ok: false, error: `probe timed out after ${opts.timeoutMs}ms` })
      if (code === 0) return settle({ ok: true })
      const detail = stderr.trim() || stdout.trim() || `exit ${code ?? -1}`
      return settle({ ok: false, error: detail.slice(0, 500) })
    })
  })
}
