import { spawn, execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export interface CodexRunOptions {
  model?: string
  sandbox?: 'read-only' | 'workspace-write' | 'danger-full-access'
  approvalPolicy?: 'untrusted' | 'on-request' | 'never'
  timeoutMs?: number
  extraArgs?: string[]
  ephemeral?: boolean
  json?: boolean
}

export interface CodexRunResult {
  transcript: string
  exitCode: number
  durationMs: number
  authMode: 'local_codex'
  costUsd: null
  inputTokens: number
  outputTokens: number
  rawJson: Record<string, unknown>
  error?: string
}

export interface CodexAdapterOptions {
  codexBin?: string
}

const DEFAULT_TIMEOUT_MS = 600_000

export class CodexCliAdapter {
  private readonly bin: string

  constructor(opts: CodexAdapterOptions = {}) {
    this.bin = opts.codexBin ?? process.env['AEDEV_CODEX_BIN'] ?? 'codex'
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('which', [this.bin], { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  async run(prompt: string, workdir: string, options: CodexRunOptions = {}): Promise<CodexRunResult> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const argv = [
      'exec',
      '--cd', workdir,
      '--sandbox', options.sandbox ?? 'workspace-write',
      '--skip-git-repo-check',
    ]
    if (options.approvalPolicy === 'never' && options.sandbox === 'danger-full-access') {
      argv.push('--dangerously-bypass-approvals-and-sandbox')
    }
    if (options.json ?? true) argv.push('--json')
    if (options.ephemeral ?? true) argv.push('--ephemeral')
    if (options.model) argv.push('--model', options.model)
    if (options.extraArgs?.length) argv.push(...options.extraArgs)
    argv.push('-')

    const start = Date.now()
    return new Promise<CodexRunResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false

      const child = spawn(this.bin, argv, {
        cwd: workdir,
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
      }, timeoutMs)

      child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
      child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
      child.stdin?.write(prompt)
      child.stdin?.end()

      const settle = (result: CodexRunResult): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        if (killTimer) clearTimeout(killTimer)
        resolve(result)
      }

      child.on('error', (err) => {
        settle({
          transcript: '',
          exitCode: -1,
          durationMs: Date.now() - start,
          authMode: 'local_codex',
          costUsd: null,
          inputTokens: 0,
          outputTokens: 0,
          rawJson: {},
          error: `spawn failed: ${err.message}`,
        })
      })

      child.on('close', (code) => {
        const durationMs = Date.now() - start
        const rawJson = parseCodexJsonl(stdout)
        const transcript = extractTranscript(rawJson, stdout)
        const usage = extractUsage(rawJson)
        const exitCode = timedOut ? 124 : (code ?? -1)
        const error =
          timedOut ? `codex CLI timed out after ${timeoutMs}ms`
          : exitCode !== 0 ? (stderr.trim() || `exit ${exitCode}`)
          : undefined

        settle({
          transcript,
          exitCode,
          durationMs,
          authMode: 'local_codex',
          costUsd: null,
          inputTokens: usage.inputTokens,
          outputTokens: usage.outputTokens,
          rawJson,
          ...(error ? { error } : {}),
        })
      })
    })
  }
}

function parseCodexJsonl(stdout: string): Record<string, unknown> {
  const events: unknown[] = []
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue
    try {
      events.push(JSON.parse(line) as unknown)
    } catch {
      return { raw_text: stdout.slice(0, 8000) }
    }
  }
  return { events }
}

function extractTranscript(rawJson: Record<string, unknown>, stdout: string): string {
  const events = rawJson['events']
  if (Array.isArray(events)) {
    for (const event of [...events].reverse()) {
      if (!event || typeof event !== 'object') continue
      const obj = event as Record<string, unknown>
      for (const key of ['message', 'text', 'content', 'output']) {
        if (typeof obj[key] === 'string' && obj[key]) return obj[key]
      }
    }
  }
  if (typeof rawJson['raw_text'] === 'string') return rawJson['raw_text']
  return stdout.trim()
}

function extractUsage(rawJson: Record<string, unknown>): { inputTokens: number; outputTokens: number } {
  const events = rawJson['events']
  let inputTokens = 0
  let outputTokens = 0
  if (Array.isArray(events)) {
    for (const event of events) {
      if (!event || typeof event !== 'object') continue
      const usage = (event as Record<string, unknown>)['usage']
      if (!usage || typeof usage !== 'object') continue
      const u = usage as Record<string, unknown>
      inputTokens += Number(u['input_tokens'] ?? u['inputTokens'] ?? 0)
      outputTokens += Number(u['output_tokens'] ?? u['outputTokens'] ?? 0)
    }
  }
  return { inputTokens, outputTokens }
}
