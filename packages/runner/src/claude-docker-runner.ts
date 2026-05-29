import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync, chmodSync } from 'fs'
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
  credentialProvider?: () => Promise<ClaudeDockerCredential>
  runDocker?: (bin: string, req: DockerExecRequest) => Promise<DockerExecResult>
  env?: NodeJS.ProcessEnv
}

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_CLAUDE_CREDENTIAL_MOUNT = '/root/.claude/.credentials.json'

export class ClaudeDockerRunner implements RunnerInterface {
  constructor(private readonly opts: ClaudeDockerRunnerOptions = {}) {}

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

    const credentialProvider = this.opts.credentialProvider ?? (() => materializeCredentialFromEnv(env))
    const credential = await credentialProvider()
    const credentialMount = credential.mountPath ?? DEFAULT_CLAUDE_CREDENTIAL_MOUNT
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const command = ['claude', '--print', '--output-format', 'json']
    const prompt = buildPrompt(task, evidenceDir)
    const dockerArgs = buildDockerArgs({
      workdir,
      evidenceDir,
      credentialPath: credential.path,
      credentialMount,
      taskId: task.id,
      runId,
      image,
      command,
    })

    let dockerResult: DockerExecResult
    try {
      dockerResult = await (this.opts.runDocker ?? spawnDocker)(this.opts.dockerBin ?? 'docker', {
        args: dockerArgs,
        stdin: prompt,
        timeoutMs,
      })
    } finally {
      await credential.cleanup?.()
    }

    const parsed = parseClaudeJson(dockerResult.stdout)
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
      inputTokens: parsed.inputTokens,
      outputTokens: parsed.outputTokens,
      costUsd: parsed.costUsd,
      durationMs: Date.now() - started,
    }, null, 2))
    writeFileSync(join(evidenceDir, 'plan.md'), ['# Plan', '', transcript].join('\n'))
    writeFileSync(join(evidenceDir, 'diff-summary.md'), '# Diff Summary\n\nClaude ran inside Docker; repository diff inspection is handled by downstream gates.\n')
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
      command,
      args: redactCredentialHostPath(dockerArgs, credential.path),
      credentialMount,
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

async function materializeCredentialFromEnv(env: NodeJS.ProcessEnv): Promise<ClaudeDockerCredential> {
  const src = env['AEDEV_CLAUDE_CREDENTIAL_FILE']
  if (!src) {
    throw new Error('HOLD-CLAUDE-AUTH-IN-DOCKER: AEDEV_CLAUDE_CREDENTIAL_FILE or an injected credentialProvider is required')
  }
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
  evidenceDir: string
  credentialPath: string
  credentialMount: string
  taskId: string
  runId: string
  image: string
  command: string[]
}): string[] {
  return [
    'run', '--rm', '-i',
    '-v', `${p.workdir}:/aedev-workdir:rw`,
    '-v', `${p.evidenceDir}:/aedev-output:rw`,
    '-v', `${p.credentialPath}:${p.credentialMount}:ro`,
    '-w', '/aedev-workdir',
    '-e', `TASK_ID=${p.taskId}`,
    '-e', `AEDEV_RUN_ID=${p.runId}`,
    p.image,
    ...p.command,
  ]
}

function buildPrompt(task: Task, evidenceDir: string): string {
  return [
    task.prompt,
    '',
    'Run PLAN -> IMPLEMENT -> self-review inside this Docker worktree.',
    'Do not push to GitHub. Do not merge. Do not add or rely on .skip tests.',
    'Do not edit .env*, secrets/**, .github/**, AGENTS.md, or other configured forbidden paths.',
    `Leave concise evidence for plan, changed files, tests/checks, self-review, and done report. Evidence directory: ${evidenceDir}`,
  ].join('\n')
}

function parseClaudeJson(stdout: string): {
  rawJson: Record<string, unknown>
  transcript: string
  model?: string
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  isError: boolean
} {
  let rawJson: Record<string, unknown> = {}
  if (stdout) {
    try {
      rawJson = JSON.parse(stdout) as Record<string, unknown>
    } catch {
      rawJson = { raw_text: stdout.slice(0, 8000) }
    }
  }
  const usage = (rawJson['usage'] as Record<string, unknown> | undefined) ?? {}
  return {
    rawJson,
    transcript: (typeof rawJson['result'] === 'string' && rawJson['result'])
      || (typeof rawJson['text'] === 'string' && rawJson['text'])
      || '',
    ...(typeof rawJson['model'] === 'string' ? { model: rawJson['model'] } : {}),
    costUsd: typeof rawJson['total_cost_usd'] === 'number' ? rawJson['total_cost_usd'] : null,
    inputTokens: Number(usage['input_tokens'] ?? 0),
    outputTokens: Number(usage['output_tokens'] ?? 0),
    isError: rawJson['is_error'] === true,
  }
}

function redactCredentialHostPath(args: string[], credentialPath: string): string[] {
  return args.map((arg) => arg.replace(credentialPath, '<claude-credential>'))
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
