import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, chmodSync, statSync } from 'fs'
import { copyFile, mkdtemp, rm } from 'fs/promises'
import { join } from 'path'
import { tmpdir } from 'os'
import type { RunnerConfig, RunResult, Task } from '@aedev/core'
import { generateId } from '@aedev/core'
import type { RunnerInterface } from './runner-interface.js'

const execFileAsync = promisify(execFile)

export interface ClaudeDockerCredential {
  path: string
  mountPath?: string
  cleanup?: () => Promise<void> | void
}

/**
 * Resolved claude auth for the container.  Two mutually exclusive shapes:
 *  - `token`: a long-lived subscription OAuth token injected as
 *    `CLAUDE_CODE_OAUTH_TOKEN` (no file mount, not keychain-bound — the proven
 *    path on macOS hosts where the keychain credential is not portable).
 *  - `file`: a `.credentials.json` materialized to a host path and bind-mounted
 *    read-only at `mountPath`.
 */
export type ClaudeDockerAuth =
  | { kind: 'token'; token: string; cleanup?: () => Promise<void> | void }
  | { kind: 'file'; credential: ClaudeDockerCredential }

export interface DockerExecRequest {
  args: string[]
  stdin: string
  timeoutMs: number
}

export interface DockerExecResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut?: boolean
  spawnError?: string
}

export interface ClaudeDockerRunnerOptions {
  dockerBin?: string
  image?: string
  timeoutMs?: number
  /** Role whose system prompt the image loads (/system_prompts/<role>.md). Default 'coder'. */
  role?: string
  /** Model id for CLAUDE_MODEL. Default 'claude-sonnet-4-6'. */
  model?: string
  /** Tool whitelist for CLAUDE_ALLOWED_TOOLS. Default the standard coder set. */
  allowedTools?: string[]
  /** Legacy file-mount credential provider. Used only when authProvider is unset. */
  credentialProvider?: () => Promise<ClaudeDockerCredential>
  /** Preferred: resolve token-or-file auth. Defaults to env (token first, then file). */
  authProvider?: () => Promise<ClaudeDockerAuth>
  runDocker?: (bin: string, req: DockerExecRequest) => Promise<DockerExecResult>
  env?: NodeJS.ProcessEnv
}

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_CLAUDE_CREDENTIAL_MOUNT = '/root/.claude/.credentials.json'
const WORKSPACE_MOUNT = '/workspace'
const DEFAULT_ROLE = 'coder'
const DEFAULT_MODEL = 'claude-sonnet-4-6'
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Edit', 'Write', 'Bash', 'Grep', 'Glob']

export type ClaudeDockerHoldCode = 'HOLD-CLAUDE-DOCKER-IMAGE' | 'HOLD-CLAUDE-AUTH-IN-DOCKER'

export interface ClaudeDockerPreflightIssue {
  holdCode: ClaudeDockerHoldCode
  reason: string
}

export interface ClaudeDockerPreflightResult {
  ready: boolean
  imageConfigured: boolean
  credentialMaterialization: 'env-file' | 'injected-provider' | 'missing'
  credentialFileConfigured: boolean
  credentialFileReadable: boolean | null
  apiFallbackEnvPresent: string[]
  issues: ClaudeDockerPreflightIssue[]
  notes: string[]
}

export interface ClaudeDockerRuntimePreflightResult extends ClaudeDockerPreflightResult {
  dockerProbeRan: boolean
  dockerProbeExitCode: number | null
}

export interface ClaudeDockerPreflightOptions {
  image?: string
  credentialProviderConfigured?: boolean
  credentialFileProbe?: (path: string) => boolean
}

const DEFAULT_PREFLIGHT_TIMEOUT_MS = 30_000
const API_FALLBACK_ENV_NAMES = ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_URL'] as const

export class ClaudeDockerRunner implements RunnerInterface {
  constructor(private readonly opts: ClaudeDockerRunnerOptions = {}) {}

  async preflightRuntime(): Promise<ClaudeDockerRuntimePreflightResult> {
    const env = this.opts.env ?? process.env
    const image = this.opts.image ?? env['AEDEV_CLAUDE_DOCKER_IMAGE']
    const staticPreflight = preflightClaudeDockerEnvironment(env, {
      image: this.opts.image,
      credentialProviderConfigured: Boolean(this.opts.credentialProvider),
    })
    if (!staticPreflight.ready || !image) {
      return { ...staticPreflight, dockerProbeRan: false, dockerProbeExitCode: null }
    }

    const credentialProvider = this.opts.credentialProvider ?? (() => materializeCredentialFromEnv(env))
    let credential: ClaudeDockerCredential
    try {
      credential = await credentialProvider()
    } catch (err) {
      return {
        ...staticPreflight,
        ready: false,
        dockerProbeRan: false,
        dockerProbeExitCode: null,
        issues: [{
          holdCode: 'HOLD-CLAUDE-AUTH-IN-DOCKER',
          reason: holdReason(err),
        }],
      }
    }

    const credentialMount = credential.mountPath ?? DEFAULT_CLAUDE_CREDENTIAL_MOUNT
    try {
      const dockerResult = await (this.opts.runDocker ?? spawnDocker)(this.opts.dockerBin ?? 'docker', {
        args: buildDockerPreflightArgs({
          image,
          credentialPath: credential.path,
          credentialMount,
        }),
        stdin: '',
        timeoutMs: Math.min(this.opts.timeoutMs ?? DEFAULT_PREFLIGHT_TIMEOUT_MS, DEFAULT_TIMEOUT_MS),
      })
      if (dockerResult.exitCode === 0 && !dockerResult.timedOut && !dockerResult.spawnError) {
        return { ...staticPreflight, dockerProbeRan: true, dockerProbeExitCode: 0 }
      }
      return {
        ...staticPreflight,
        ready: false,
        dockerProbeRan: true,
        dockerProbeExitCode: dockerResult.exitCode,
        issues: [{
          holdCode: 'HOLD-CLAUDE-AUTH-IN-DOCKER',
          reason: redactCredentialHostPath([
            dockerResult.spawnError ?? (dockerResult.stderr.trim() || dockerResult.stdout.trim() || `docker probe exited ${dockerResult.exitCode}`),
          ], credential.path)[0] ?? 'claude docker preflight failed',
        }],
      }
    } finally {
      await credential.cleanup?.()
    }
  }

  async run(task: Task, config: RunnerConfig): Promise<RunResult> {
    const started = Date.now()
    const runId = generateId()
    const workdir = join(config.worktreeBaseDir, task.id)
    const evidenceDir = join(config.outputBaseDir, task.id)
    mkdirSync(evidenceDir, { recursive: true })
    await prepareWorktree(workdir, config)

    const env = this.opts.env ?? process.env
    const image = this.opts.image ?? env['AEDEV_CLAUDE_DOCKER_IMAGE']
    if (!image) {
      throw new Error('HOLD-CLAUDE-DOCKER-IMAGE: AEDEV_CLAUDE_DOCKER_IMAGE is required for claude-docker runner')
    }

    const authProvider = this.opts.authProvider
      ?? (this.opts.credentialProvider
        ? async (): Promise<ClaudeDockerAuth> => ({ kind: 'file', credential: await this.opts.credentialProvider!() })
        : () => resolveAuthFromEnv(env))
    const auth = await authProvider()
    const credentialMount = auth.kind === 'file'
      ? (auth.credential.mountPath ?? DEFAULT_CLAUDE_CREDENTIAL_MOUNT)
      : undefined
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const role = this.opts.role ?? DEFAULT_ROLE
    const model = this.opts.model ?? env['AEDEV_CLAUDE_MODEL'] ?? DEFAULT_MODEL
    const allowedTools = this.opts.allowedTools ?? DEFAULT_ALLOWED_TOOLS

    // The runner image's ENTRYPOINT (/entrypoint.sh, WORKDIR /workspace) reads the
    // user prompt from /workspace/prompt.txt, runs claude with the role system prompt,
    // and writes /workspace/result.json.  We honor that contract rather than override
    // the entrypoint: write prompt.txt into the mounted worktree, pass CLAUDE_* env.
    writeFileSync(join(workdir, 'prompt.txt'), buildPrompt(task))
    const dockerArgs = buildDockerArgs({
      workdir, auth, credentialMount, taskId: task.id, runId, image,
      role, model, allowedTools, permissionMode: 'bypassPermissions',
    })

    let dockerResult: DockerExecResult
    try {
      dockerResult = await (this.opts.runDocker ?? spawnDocker)(this.opts.dockerBin ?? 'docker', {
        args: dockerArgs,
        stdin: '',
        timeoutMs,
      })
    } finally {
      await (auth.kind === 'file' ? auth.credential.cleanup?.() : auth.cleanup?.())
    }

    // Token/cost source of truth, in priority order:
    //   1. /workspace/cli-envelope.json — the RAW claude CLI envelope written by
    //      the runner:e2e1 entrypoint BEFORE normalization (authoritative usage).
    //   2. /workspace/result.json — the normalized envelope (usage may be 0 on
    //      stock runner:latest when the coder authors its own result.json).
    //   3. docker stdout (injected-fake test path).
    const cliEnvelopePath = join(workdir, 'cli-envelope.json')
    const resultJsonPath = join(workdir, 'result.json')
    const cliEnvelope = existsSync(cliEnvelopePath) ? readFileSync(cliEnvelopePath, 'utf8') : ''
    const resultJson = existsSync(resultJsonPath) ? readFileSync(resultJsonPath, 'utf8') : ''
    const parsed = parseClaudeJson(resultJson || dockerResult.stdout)
    // Prefer authoritative token counts from the raw CLI envelope when present.
    const envelope = cliEnvelope ? parseClaudeJson(cliEnvelope) : undefined
    const inputTokens = (envelope && envelope.inputTokens > 0) ? envelope.inputTokens : parsed.inputTokens
    const outputTokens = (envelope && envelope.outputTokens > 0) ? envelope.outputTokens : parsed.outputTokens
    const costUsd = envelope?.costUsd ?? parsed.costUsd
    const exitCode = dockerResult.timedOut
      ? 124
      : dockerResult.exitCode !== 0 || parsed.isError
        ? (dockerResult.exitCode === 0 ? 1 : dockerResult.exitCode)
        : 0
    const transcript = parsed.transcript || dockerResult.stderr.trim() || '(no transcript)'

    writeFileSync(join(evidenceDir, 'stdout.log'), dockerResult.stdout)
    writeFileSync(join(evidenceDir, 'stderr.log'), dockerResult.stderr)
    writeFileSync(join(evidenceDir, 'claude-docker-raw.json'), JSON.stringify(parsed.rawJson, null, 2))
    writeFileSync(join(evidenceDir, 'transcript-summary.md'), transcript)
    writeFileSync(join(evidenceDir, 'model-usage.json'), JSON.stringify({
      provider: 'claude-docker',
      model: parsed.model,
      inputTokens,
      outputTokens,
      costUsd,
      durationMs: Date.now() - started,
    }, null, 2))
    writeFileSync(join(evidenceDir, 'plan.md'), ['# Plan', '', transcript].join('\n'))
    // Real diff summary from the coder's actual git changes (committed vs origin
    // base + uncommitted), so validators + risk scoring see the true change set
    // instead of a stub.  Stale stub previously made validators rightly suspicious.
    writeFileSync(join(evidenceDir, 'diff-summary.md'), await renderRealDiffSummary(workdir))
    writeFileSync(join(evidenceDir, 'test-summary.md'), [
      '# Test Summary',
      '',
      `Docker exit code: ${dockerResult.exitCode}`,
      `Final exit code: ${exitCode}`,
      dockerResult.spawnError ? `Spawn error: ${dockerResult.spawnError}` : '',
    ].filter(Boolean).join('\n'))
    writeFileSync(join(evidenceDir, 'done-report.md'), [
      '# Done Report',
      '',
      `Task: ${task.id}`,
      'Runner: claude-docker',
      `Final exit code: ${exitCode}`,
      `Worktree: ${workdir}`,
      `Evidence: ${evidenceDir}`,
    ].join('\n'))
    writeFileSync(join(evidenceDir, 'docker-meta.json'), JSON.stringify({
      runId,
      taskId: task.id,
      image,
      entrypoint: 'image-default (/entrypoint.sh; prompt.txt + CLAUDE_ROLE contract)',
      role,
      model,
      authKind: auth.kind,
      args: redactAuthSecrets(dockerArgs, auth),
      credentialMount: credentialMount ?? null,
      timedOut: dockerResult.timedOut ?? false,
      exitCode: dockerResult.exitCode,
      spawnError: dockerResult.spawnError,
      strippedEnv: ['ANTHROPIC_API_KEY', 'ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_API_URL'],
    }, null, 2))

    return {
      runId,
      taskId: task.id,
      exitCode,
      evidenceDir,
      durationMs: Date.now() - started,
    }
  }
}

/**
 * Build a real diff-summary from the coder's git changes: committed work on top
 * of the pristine base (origin/HEAD) plus any uncommitted edits, with a name-stat
 * and changed-file list.  Excludes the harness scaffolding files (prompt.txt,
 * result.json, cli-envelope.json).  Falls back to a clear "no changes" note.
 */
async function renderRealDiffSummary(workdir: string): Promise<string> {
  if (!existsSync(join(workdir, '.git'))) {
    return '# Diff Summary\n\n(worktree is not a git repository)\n'
  }
  const HARNESS = new Set(['prompt.txt', 'result.json', 'cli-envelope.json'])
  const git = async (args: string[]): Promise<string> => {
    try {
      const { stdout } = await execFileAsync('git', ['-C', workdir, ...args], { timeout: 30_000, maxBuffer: 8 * 1024 * 1024 })
      return stdout.trim()
    } catch {
      return ''
    }
  }
  let base = await git(['rev-parse', 'origin/HEAD'])
  if (!base) base = await git(['rev-parse', 'HEAD'])
  const committedStat = base ? await git(['diff', '--stat', `${base}..HEAD`]) : ''
  const porcelain = await git(['status', '--porcelain=v1'])
  const changed = [
    ...(base ? (await git(['diff', '--name-only', `${base}..HEAD`])).split('\n') : []),
    ...porcelain.split('\n').map((l) => l.slice(3).replace(/^"|"$/g, '')),
  ].filter(Boolean).filter((p) => !HARNESS.has(p))
  const uniq = [...new Set(changed)].sort()
  const lines = [
    '# Diff Summary',
    '',
    `Base: ${base || '(unknown)'}`,
    '',
    '## Changed files',
    uniq.length ? uniq.map((p) => `- ${p}`).join('\n') : '- (no coder changes detected)',
    '',
    '## git diff --stat (committed vs base)',
    '```',
    committedStat || '(no committed diff)',
    '```',
    '',
  ]
  return lines.join('\n') + '\n'
}

async function prepareWorktree(workdir: string, config: RunnerConfig): Promise<void> {
  rmSync(workdir, { recursive: true, force: true })
  const source = config.sourceRepoPath
  if (!source) {
    mkdirSync(workdir, { recursive: true })
    return
  }
  if (existsSync(join(source, '.git'))) {
    await execFileAsync('git', ['clone', '--no-hardlinks', source, workdir], { timeout: 120_000 })
    return
  }
  mkdirSync(workdir, { recursive: true })
  cpSync(source, workdir, { recursive: true, force: true })
}

/**
 * Resolve container auth from env.  Prefers the long-lived OAuth token
 * (`AEDEV_CLAUDE_OAUTH_TOKEN`, injected as `CLAUDE_CODE_OAUTH_TOKEN` — the proven
 * keychain-free path); falls back to a `.credentials.json` file mount
 * (`AEDEV_CLAUDE_CREDENTIAL_FILE`).  Neither present → HOLD.
 */
async function resolveAuthFromEnv(env: NodeJS.ProcessEnv): Promise<ClaudeDockerAuth> {
  const token = env['AEDEV_CLAUDE_OAUTH_TOKEN']
  if (token) return { kind: 'token', token }
  const src = env['AEDEV_CLAUDE_CREDENTIAL_FILE']
  if (src) return { kind: 'file', credential: await materializeCredentialFromEnv(env) }
  throw new Error('HOLD-CLAUDE-AUTH-IN-DOCKER: set AEDEV_CLAUDE_OAUTH_TOKEN (preferred) or AEDEV_CLAUDE_CREDENTIAL_FILE, or inject an authProvider')
}

async function materializeCredentialFile(src: string): Promise<ClaudeDockerCredential> {
  const dir = await mkdtemp(join(tmpdir(), 'aedev-claude-docker-'))
  const dest = join(dir, '.credentials.json')
  await copyFile(src, dest)
  chmodSync(dest, 0o600)
  return {
    path: dest,
    cleanup: async () => {
      await rm(dir, { recursive: true, force: true })
    },
  }
}

function buildDockerArgs(p: {
  workdir: string
  auth: ClaudeDockerAuth
  credentialMount?: string
  taskId: string
  runId: string
  image: string
  role: string
  model: string
  allowedTools: string[]
  permissionMode: string
}): string[] {
  const authArgs = p.auth.kind === 'token'
    ? ['-e', `CLAUDE_CODE_OAUTH_TOKEN=${p.auth.token}`]
    : ['-v', `${p.auth.credential.path}:${p.credentialMount}:ro`]
  return [
    'run', '--rm',
    // Mount the per-task worktree at /workspace — the image entrypoint reads
    // /workspace/prompt.txt and writes /workspace/result.json there.
    '-v', `${p.workdir}:${WORKSPACE_MOUNT}:rw`,
    '-w', WORKSPACE_MOUNT,
    // Strip inherited paid-API env so the container cannot fall back to metered API.
    '-e', 'ANTHROPIC_API_KEY=', '-e', 'ANTHROPIC_BASE_URL=',
    '-e', 'ANTHROPIC_AUTH_TOKEN=', '-e', 'ANTHROPIC_API_URL=',
    ...authArgs,
    '-e', `CLAUDE_ROLE=${p.role}`,
    '-e', `CLAUDE_MODEL=${p.model}`,
    '-e', `CLAUDE_PERMISSION_MODE=${p.permissionMode}`,
    '-e', `CLAUDE_ALLOWED_TOOLS=${p.allowedTools.join(',')}`,
    '-e', `TASK_ID=${p.taskId}`,
    '-e', `AEDEV_RUN_ID=${p.runId}`,
    p.image,
  ]
}

function buildPrompt(task: Task): string {
  return [
    task.prompt,
    '',
    'Run PLAN -> IMPLEMENT -> self-review inside this workspace.',
    'Do not push to GitHub. Do not merge. Do not add or rely on .skip tests.',
    'Do not edit .env*, secrets/**, .github/**, AGENTS.md, or other configured forbidden paths.',
  ].join('\n')
}

/**
 * Parse the image's /workspace/result.json envelope (or a raw claude --print
 * JSON as fallback): { result | raw_text, is_error, usage{input_tokens,
 * output_tokens}, cost_usd | total_cost_usd }.
 */
function parseClaudeJson(text: string): {
  rawJson: Record<string, unknown>
  transcript: string
  model?: string
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  isError: boolean
} {
  let rawJson: Record<string, unknown> = {}
  if (text) {
    try {
      rawJson = JSON.parse(text) as Record<string, unknown>
    } catch {
      rawJson = { raw_text: text.slice(0, 8000) }
    }
  }
  const usage = (rawJson['usage'] as Record<string, unknown> | undefined) ?? {}
  const cost = rawJson['cost_usd'] ?? rawJson['total_cost_usd']
  return {
    rawJson,
    transcript: (typeof rawJson['result'] === 'string' && rawJson['result'])
      || (typeof rawJson['raw_text'] === 'string' && rawJson['raw_text'])
      || (typeof rawJson['text'] === 'string' && rawJson['text'])
      || (typeof rawJson['summary'] === 'string' && rawJson['summary'])
      || '',
    ...(typeof rawJson['model'] === 'string' ? { model: rawJson['model'] } : {}),
    costUsd: typeof cost === 'number' ? cost : null,
    inputTokens: Number(usage['input_tokens'] ?? 0),
    outputTokens: Number(usage['output_tokens'] ?? 0),
    isError: rawJson['is_error'] === true,
  }
}

/** Redact the auth secret (token value or credential host path) from logged args. */
function redactAuthSecrets(args: string[], auth: ClaudeDockerAuth): string[] {
  return args.map((arg) => {
    if (auth.kind === 'token') {
      return arg.startsWith('CLAUDE_CODE_OAUTH_TOKEN=') ? 'CLAUDE_CODE_OAUTH_TOKEN=<redacted>' : arg
    }
    return arg.replace(auth.credential.path, '<claude-credential>')
  })
}

async function spawnDocker(bin: string, req: DockerExecRequest): Promise<DockerExecResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false
    const child = spawn(bin, req.args, {
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: true,
    })

    const killGroup = (signal: NodeJS.Signals): void => {
      if (child.pid !== undefined) {
        try { process.kill(-child.pid, signal) } catch { /* already gone */ }
      }
    }

    let killTimer: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      timedOut = true
      killGroup('SIGTERM')
      killTimer = setTimeout(() => {
        if (!settled) killGroup('SIGKILL')
      }, 500)
    }, req.timeoutMs)

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    child.stdin?.write(req.stdin)
    child.stdin?.end()

    const settle = (r: DockerExecResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve(r)
    }

    child.on('error', (err) => {
      settle({ exitCode: -1, stdout, stderr, timedOut, spawnError: err.message })
    })
    child.on('close', (code) => {
      settle({ exitCode: code ?? -1, stdout, stderr, timedOut })
    })
  })
}

export function preflightClaudeDockerEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  opts: ClaudeDockerPreflightOptions = {},
): ClaudeDockerPreflightResult {
  const imageConfigured = Boolean((opts.image ?? env['AEDEV_CLAUDE_DOCKER_IMAGE'])?.trim())
  const credentialFileConfigured = Boolean(env['AEDEV_CLAUDE_CREDENTIAL_FILE']?.trim())
  const credentialMaterialization =
    opts.credentialProviderConfigured ? 'injected-provider'
      : credentialFileConfigured ? 'env-file'
        : 'missing'
  const credentialFileReadable =
    credentialMaterialization === 'env-file'
      ? (opts.credentialFileProbe ?? defaultCredentialFileProbe)(env['AEDEV_CLAUDE_CREDENTIAL_FILE'] ?? '')
      : credentialMaterialization === 'injected-provider'
        ? true
        : null
  const apiFallbackEnvPresent = API_FALLBACK_ENV_NAMES.filter((name) => Boolean(env[name]))
  const issues: ClaudeDockerPreflightIssue[] = []

  if (!imageConfigured) {
    issues.push({
      holdCode: 'HOLD-CLAUDE-DOCKER-IMAGE',
      reason: 'AEDEV_CLAUDE_DOCKER_IMAGE is required; no default image is allowed for claude-docker.',
    })
  }
  if (credentialMaterialization === 'missing') {
    issues.push({
      holdCode: 'HOLD-CLAUDE-AUTH-IN-DOCKER',
      reason: 'AEDEV_CLAUDE_CREDENTIAL_FILE or an injected credentialProvider is required; macOS keychain auth is not mounted into Linux containers.',
    })
  } else if (credentialMaterialization === 'env-file' && !credentialFileReadable) {
    issues.push({
      holdCode: 'HOLD-CLAUDE-AUTH-IN-DOCKER',
      reason: 'AEDEV_CLAUDE_CREDENTIAL_FILE must point to a readable file before claude-docker can run.',
    })
  }

  return {
    ready: issues.length === 0,
    imageConfigured,
    credentialMaterialization,
    credentialFileConfigured,
    credentialFileReadable,
    apiFallbackEnvPresent,
    issues,
    notes: [
      'Claude Docker never uses Anthropic API fallback credentials for subscription auth.',
      'API fallback environment variables are stripped from the container when present.',
      'The credential source path is intentionally omitted from preflight output.',
    ],
  }
}

async function materializeCredentialFromEnv(env: NodeJS.ProcessEnv): Promise<ClaudeDockerCredential> {
  const src = env['AEDEV_CLAUDE_CREDENTIAL_FILE']
  if (!src) {
    throw new Error('HOLD-CLAUDE-AUTH-IN-DOCKER: AEDEV_CLAUDE_CREDENTIAL_FILE or an injected credentialProvider is required')
  }
  if (!defaultCredentialFileProbe(src)) {
    throw new Error('HOLD-CLAUDE-AUTH-IN-DOCKER: AEDEV_CLAUDE_CREDENTIAL_FILE must point to a readable file')
  }
  return materializeCredentialFile(src)
}

function defaultCredentialFileProbe(path: string): boolean {
  try {
    return existsSync(path) && statSync(path).isFile()
  } catch {
    return false
  }
}

function buildDockerPreflightArgs(p: {
  image: string
  credentialPath: string
  credentialMount: string
}): string[] {
  return [
    'run', '--rm', '-i',
    '-v', `${p.credentialPath}:${p.credentialMount}:ro`,
    p.image,
    'sh', '-lc', `command -v claude >/dev/null && test -r ${shellQuote(p.credentialMount)}`,
  ]
}

function redactCredentialHostPath(args: string[], credentialPath: string): string[] {
  return args.map((arg) => arg.replace(credentialPath, '<claude-credential>'))
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function holdReason(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}
