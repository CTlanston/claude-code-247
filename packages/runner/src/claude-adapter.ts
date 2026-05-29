import { spawn, execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

/**
 * Headless invocation of the local `claude` CLI.  Mirrors the Python
 * `runner/claude_cli.py` shape so the TypeScript control plane can run the
 * same role/prompt protocol that the Python kernel uses today.
 *
 * Per ADR-0009 and non-negotiable rule #4, subscription-mode is the default:
 * when `authMode === 'local_claude_code'`, `ANTHROPIC_API_KEY` and
 * `ANTHROPIC_BASE_URL` are stripped from the subprocess env to prevent silent
 * API fallback.  Callers must explicitly opt into `authMode: 'anthropic_api'`
 * for billed API usage.
 */
export type ClaudeAuthMode = 'local_claude_code' | 'anthropic_api'

export interface ClaudeRunOptions {
  systemPrompt?: string
  model?: string
  allowedTools?: string[]
  permissionMode?: string
  timeoutMs?: number
  /** Defaults to local subscription auth. API mode must be explicit. */
  authMode?: ClaudeAuthMode
  extraArgs?: string[]
  onStdout?: (chunk: string) => void
  onStderr?: (chunk: string) => void
}

export interface ClaudeRunResult {
  transcript: string
  exitCode: number
  durationMs: number
  authMode: ClaudeAuthMode
  costUsd: number | null
  inputTokens: number
  outputTokens: number
  rawJson: Record<string, unknown>
  error?: string
}

export interface ClaudeAdapterOptions {
  /** Override the `claude` binary path.  Falls back to `AEDEV_CLAUDE_BIN` env, then `claude`. */
  claudeBin?: string
}

const DEFAULT_PERMISSION_MODE = 'bypassPermissions'
const DEFAULT_TIMEOUT_MS = 600_000 // 10 minutes

export class ClaudeCodeAdapter {
  private readonly bin: string

  constructor(opts: ClaudeAdapterOptions = {}) {
    this.bin = opts.claudeBin ?? process.env['AEDEV_CLAUDE_BIN'] ?? 'claude'
  }

  /** Returns true iff the configured `claude` binary is resolvable on PATH (or the override exists). */
  async isAvailable(): Promise<boolean> {
    try {
      // `which` resolves PATH; if `bin` is an absolute path, this still works.
      await execFileAsync('which', [this.bin], { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  /**
   * Run one headless `claude --print` invocation.  Prompt is sent via stdin.
   *
   * Argv shape:
   *   claude --print --output-format json
   *          --append-system-prompt <SYS>
   *          --permission-mode <MODE>
   *          [--model M] [--allowedTools t1,t2,...]
   *          [extra args...]
   */
  async run(prompt: string, workdir: string, options: ClaudeRunOptions = {}): Promise<ClaudeRunResult> {
    const systemPrompt = options.systemPrompt ?? ''
    const permissionMode = options.permissionMode ?? DEFAULT_PERMISSION_MODE
    const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const authMode: ClaudeAuthMode = options.authMode ?? 'local_claude_code'

    const argv: string[] = [
      '--print', '--output-format', 'json',
      '--append-system-prompt', systemPrompt,
      '--permission-mode', permissionMode,
    ]
    if (options.model) argv.push('--model', options.model)
    if (options.allowedTools?.length) argv.push('--allowedTools', options.allowedTools.join(','))
    if (options.extraArgs?.length) argv.push(...options.extraArgs)

    // Subscription-mode strips API credentials so the CLI is forced onto the
    // local keychain credential.  This is the non-negotiable safety gate
    // against silent paid-API fallback.
    const env: NodeJS.ProcessEnv = { ...process.env }
    if (authMode === 'local_claude_code') {
      delete env['ANTHROPIC_API_KEY']
      delete env['ANTHROPIC_BASE_URL']
      delete env['ANTHROPIC_AUTH_TOKEN']
      delete env['ANTHROPIC_API_URL']
    }

    const start = Date.now()
    return new Promise<ClaudeRunResult>((resolve) => {
      let stdout = ''
      let stderr = ''
      let timedOut = false
      let settled = false

      const child = spawn(this.bin, argv, {
        cwd: workdir,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,  // own process group so we can signal the whole tree
      })

      const killGroup = (signal: NodeJS.Signals): void => {
        if (child.pid !== undefined) {
          try { process.kill(-child.pid, signal) } catch { /* already gone */ }
        }
      }

      let killTimer: NodeJS.Timeout | undefined
      const timer = setTimeout(() => {
        timedOut = true
        // SIGTERM the whole process group so grandchildren (e.g. `sh` then
        // `sleep`) all die.  Otherwise the stdio pipes stay open and the
        // close event never fires.
        killGroup('SIGTERM')
        killTimer = setTimeout(() => {
          if (!settled) killGroup('SIGKILL')
        }, 500)
      }, timeoutMs)

      child.stdout?.on('data', (d: Buffer) => {
        const chunk = d.toString()
        stdout += chunk
        options.onStdout?.(chunk)
      })
      child.stderr?.on('data', (d: Buffer) => {
        const chunk = d.toString()
        stderr += chunk
        options.onStderr?.(chunk)
      })

      child.stdin?.write(prompt)
      child.stdin?.end()

      const settle = (result: ClaudeRunResult): void => {
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
          authMode,
          costUsd: null,
          inputTokens: 0,
          outputTokens: 0,
          rawJson: {},
          error: `spawn failed: ${err.message}`,
        })
      })

      child.on('close', (code) => {
        const durationMs = Date.now() - start
        let rawJson: Record<string, unknown> = {}
        if (stdout) {
          try {
            rawJson = JSON.parse(stdout) as Record<string, unknown>
          } catch {
            rawJson = { raw_text: stdout.slice(0, 8000) }
          }
        }
        const transcript =
          (typeof rawJson['result'] === 'string' && rawJson['result']) ||
          (typeof rawJson['text'] === 'string' && rawJson['text']) ||
          ''
        const usage = (rawJson['usage'] as Record<string, unknown> | undefined) ?? {}
        const isError = rawJson['is_error'] === true
        const exitCode = timedOut ? 124 : (code ?? -1)
        const error =
          timedOut ? `claude CLI timed out after ${timeoutMs}ms`
          : (exitCode !== 0 || isError) ? (stderr.trim() || `exit ${exitCode}`)
          : undefined

        settle({
          transcript,
          exitCode,
          durationMs,
          authMode,
          costUsd: typeof rawJson['total_cost_usd'] === 'number' ? (rawJson['total_cost_usd']) : null,
          inputTokens: Number(usage['input_tokens'] ?? 0),
          outputTokens: Number(usage['output_tokens'] ?? 0),
          rawJson,
          ...(error ? { error } : {}),
        })
      })
    })
  }
}
