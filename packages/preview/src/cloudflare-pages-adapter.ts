import { execFile, spawn } from 'child_process'
import { promisify } from 'util'
import type { PreviewAdapter, PreviewDeployRequest, PreviewResult } from './preview-adapter.js'

const execFileAsync = promisify(execFile)

/**
 * Cloudflare Pages adapter — wraps `wrangler pages deploy <outputDir>` and
 * extracts the preview URL from wrangler's stdout.  The Cloudflare API token
 * lives in `AEDEV_CLOUDFLARE_API_TOKEN` (or the per-call `req.token`).
 * Per ADR-0009, missing token returns `requiresSecretGrant: true` instead of
 * throwing — the daemon opens a secret-grant approval.
 */
export interface CloudflarePagesAdapterOptions {
  /** Override the `wrangler` binary path.  Default: env AEDEV_WRANGLER_BIN, then `wrangler`. */
  wranglerBin?: string
  /** Cloudflare account id (`AEDEV_CLOUDFLARE_ACCOUNT_ID` env if not supplied). */
  accountId?: string
  /** Override the env var name probed for the API token (lets ops configure rotation). */
  tokenEnvVar?: string
  timeoutMs?: number
}

const DEFAULT_TIMEOUT_MS = 5 * 60_000
const DEFAULT_TOKEN_ENV = 'AEDEV_CLOUDFLARE_API_TOKEN'

const PAGES_DEV_RE = /(https?:\/\/[a-z0-9.-]+\.pages\.dev[^\s]*)/i

export class CloudflarePagesAdapter implements PreviewAdapter {
  readonly provider = 'cloudflare-pages' as const
  private readonly bin: string
  private readonly accountId: string | undefined
  private readonly tokenEnvVar: string
  private readonly timeoutMs: number

  constructor(opts: CloudflarePagesAdapterOptions = {}) {
    this.bin = opts.wranglerBin ?? process.env['AEDEV_WRANGLER_BIN'] ?? 'wrangler'
    this.accountId = opts.accountId ?? process.env['AEDEV_CLOUDFLARE_ACCOUNT_ID']
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

    const args = ['pages', 'deploy', req.outputDir, '--project-name', req.projectName]
    if (req.branchName) args.push('--branch', req.branchName)

    const env: NodeJS.ProcessEnv = {
      ...process.env,
      [this.tokenEnvVar]: token,
      CLOUDFLARE_API_TOKEN: token,  // wrangler's canonical env
    }
    if (this.accountId) env['CLOUDFLARE_ACCOUNT_ID'] = this.accountId

    const { exitCode, stdout, stderr } = await spawnCapture(this.bin, args, env, this.timeoutMs)
    if (exitCode !== 0) {
      return {
        url: null,
        provider: this.provider,
        deployedAt: new Date().toISOString(),
        requiresSecretGrant: false,
        meta: { stdout, stderr, exitCode },
        error: stderr.trim() || `wrangler exited with code ${exitCode}`,
      }
    }
    const match = stdout.match(PAGES_DEV_RE) ?? stderr.match(PAGES_DEV_RE)
    const url = match?.[1] ?? null
    return {
      url,
      provider: this.provider,
      deployedAt: new Date().toISOString(),
      requiresSecretGrant: false,
      meta: { stdout, stderr, project: req.projectName },
      error: url ? undefined : 'wrangler succeeded but no pages.dev URL parsed from stdout',
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
      if (child.pid !== undefined) try { process.kill(-child.pid, 'SIGTERM') } catch { /* already gone */ }
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
