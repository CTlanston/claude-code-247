import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import type { PreviewAdapter, PreviewDeployRequest, PreviewResult } from './preview-adapter.js'

const execFileAsync = promisify(execFile)

/**
 * Vercel adapter — wraps `vercel deploy <outputDir>` (or `vercel --prod=false`)
 * and extracts the preview URL.  Token from `AEDEV_VERCEL_TOKEN`.
 */
export interface VercelAdapterOptions {
  vercelBin?: string
  tokenEnvVar?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const DEFAULT_TOKEN_ENV = 'AEDEV_VERCEL_TOKEN'
const VERCEL_URL_RE = /(https?:\/\/[a-z0-9.-]+\.vercel\.app[^\s]*)/i

export class VercelAdapter implements PreviewAdapter {
  readonly provider = 'vercel' as const
  private readonly bin: string
  private readonly tokenEnvVar: string
  private readonly timeoutMs: number

  constructor(opts: VercelAdapterOptions = {}) {
    this.bin = opts.vercelBin ?? process.env['AEDEV_VERCEL_BIN'] ?? 'vercel'
    this.tokenEnvVar = opts.tokenEnvVar ?? DEFAULT_TOKEN_ENV
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
  }

  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync(this.bin, ['--version'], { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  async deploy(req: PreviewDeployRequest): Promise<PreviewResult> {
    const token = req.token ?? process.env[this.tokenEnvVar]
    if (!token) {
      return {
        url: null,
        provider: this.provider,
        deployedAt: new Date().toISOString(),
        requiresSecretGrant: true,
        requiredSecretName: this.tokenEnvVar,
        meta: { project: req.projectName },
      }
    }

    const args = ['deploy', req.outputDir, '--token', token, '--yes', '--name', req.projectName]
    if (req.branchName) args.push('--meta', `branch=${req.branchName}`)

    const { exitCode, stdout, stderr } = await spawnCapture(this.bin, args, { ...process.env }, this.timeoutMs)
    if (exitCode !== 0) {
      return {
        url: null,
        provider: this.provider,
        deployedAt: new Date().toISOString(),
        requiresSecretGrant: false,
        meta: { stdout, stderr, exitCode },
        error: stderr.trim() || `vercel exited with code ${exitCode}`,
      }
    }
    // Vercel CLI prints the URL on stdout, often as the first line.
    const match = stdout.match(VERCEL_URL_RE) ?? stderr.match(VERCEL_URL_RE)
    const url = match?.[1] ?? null
    return {
      url,
      provider: this.provider,
      deployedAt: new Date().toISOString(),
      requiresSecretGrant: false,
      meta: { stdout, stderr, project: req.projectName },
      error: url ? undefined : 'vercel succeeded but no vercel.app URL parsed from stdout',
    }
  }
}

interface CaptureResult { exitCode: number; stdout: string; stderr: string }

async function spawnCapture(bin: string, args: string[], env: NodeJS.ProcessEnv, timeoutMs: number): Promise<CaptureResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(bin, args, { env, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
    const settle = (r: CaptureResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (killTimer) clearTimeout(killTimer)
      resolve(r)
    }
    let killTimer: NodeJS.Timeout | undefined
    const timer = setTimeout(() => {
      if (child.pid !== undefined) try { process.kill(-child.pid, 'SIGTERM') } catch { /* gone */ }
      killTimer = setTimeout(() => {
        if (!settled && child.pid !== undefined) try { process.kill(-child.pid, 'SIGKILL') } catch { /* gone */ }
      }, 500)
    }, timeoutMs)
    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })
    child.on('error', (e) => settle({ exitCode: -1, stdout, stderr: stderr + `\nspawn error: ${e.message}` }))
    child.on('close', (code) => settle({ exitCode: code ?? -1, stdout, stderr }))
  })
}
