import { execFile } from 'child_process'
import { promisify } from 'util'
import { readdirSync, readFileSync, existsSync, statSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'

const execFileAsync = promisify(execFile)

/**
 * Subprocess-based interop between the TypeScript `aedev` control plane and
 * the Python `claude247` execution kernel.  All methods are thin wrappers
 * around the `claude247` CLI's JSON-emitting commands.
 *
 * Per ADR-0009, this bridge is the only place the TS runtime shells out to
 * Python.  It survives in tree until the TS runtime reaches parity on
 * worker execution, validator orchestration, and GitHub PR creation.
 */
export interface Claude247BridgeOptions {
  /** Override the `claude247` binary.  Defaults to env `AEDEV_CLAUDE247_BIN`, then `claude247`. */
  claude247Bin?: string
  /** Override the claude-code-247 home dir.  Defaults to env `CLAUDE247_HOME`, then `~/.claude-code-247`. */
  homeDir?: string
  /** Timeout for individual CLI calls.  Defaults to 30 seconds. */
  cliTimeoutMs?: number
}

export interface Claude247EnqueueOptions {
  source?: string       // default 'aedev'
  sourceRef?: string    // optional ref (aedev task id, mission id, etc.)
}

export interface Claude247EnqueueResult {
  commandId: string
  status: string
  queuedAt: string
}

export interface Claude247Task {
  id: string
  repo: string
  status: string
  goal: string
  branch: string | null
  pr: number | null
  createdAt: string
}

export interface Claude247TaskDetail extends Claude247Task {
  riskScore: number | null
  updatedAt: string
  finishedAt: string | null
  events: Array<Record<string, unknown>>
}

const DEFAULT_CLI_TIMEOUT_MS = 30_000

export class Claude247Bridge {
  private readonly bin: string
  private readonly home: string
  private readonly cliTimeoutMs: number

  constructor(opts: Claude247BridgeOptions = {}) {
    this.bin = opts.claude247Bin ?? process.env['AEDEV_CLAUDE247_BIN'] ?? 'claude247'
    this.home = opts.homeDir ?? process.env['CLAUDE247_HOME'] ?? join(homedir(), '.claude-code-247')
    this.cliTimeoutMs = opts.cliTimeoutMs ?? DEFAULT_CLI_TIMEOUT_MS
  }

  /** Returns true iff the `claude247` binary is on PATH (or the override resolves). */
  async isAvailable(): Promise<boolean> {
    try {
      await execFileAsync('which', [this.bin], { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  /** Enqueue a new task via `claude247 start --repo X --goal Y --json`. */
  async enqueue(
    repoId: string,
    goal: string,
    opts: Claude247EnqueueOptions = {},
  ): Promise<Claude247EnqueueResult> {
    const args = ['start', '--repo', repoId, '--goal', goal, '--json']
    if (opts.source) args.push('--source', opts.source)
    else args.push('--source', 'aedev')
    if (opts.sourceRef) args.push('--source-ref', opts.sourceRef)

    const { stdout } = await execFileAsync(this.bin, args, { timeout: this.cliTimeoutMs })
    const parsed = JSON.parse(stdout) as { command_id?: string; status?: string; queued_at?: string }
    if (!parsed.command_id) throw new Error(`claude247 start returned unexpected payload: ${stdout}`)
    return {
      commandId: parsed.command_id,
      status: parsed.status ?? 'unknown',
      queuedAt: parsed.queued_at ?? '',
    }
  }

  /** List tasks via `claude247 tasks --json`. */
  async listTasks(opts: { repoId?: string; status?: string; limit?: number } = {}): Promise<Claude247Task[]> {
    const args = ['tasks', '--json']
    if (opts.repoId) args.push('--repo', opts.repoId)
    if (opts.status) args.push('--status', opts.status)
    if (opts.limit !== undefined) args.push('--limit', String(opts.limit))

    const { stdout } = await execFileAsync(this.bin, args, { timeout: this.cliTimeoutMs })
    const raw = JSON.parse(stdout) as Array<{
      id: string; repo: string; status: string; goal: string;
      branch: string | null; pr: number | null; created_at: string;
    }>
    return raw.map((t) => ({
      id: t.id, repo: t.repo, status: t.status, goal: t.goal,
      branch: t.branch, pr: t.pr, createdAt: t.created_at,
    }))
  }

  /** Get one task's full detail + event timeline via `claude247 task <id> --json`. */
  async getTask(taskId: string): Promise<Claude247TaskDetail | null> {
    try {
      const { stdout } = await execFileAsync(this.bin, ['task', taskId, '--json'], { timeout: this.cliTimeoutMs })
      const raw = JSON.parse(stdout) as {
        id: string; repo: string; status: string; goal: string;
        branch: string | null; pr: number | null; created_at: string;
        updated_at: string; finished_at: string | null;
        risk_score: number | null; events: Array<Record<string, unknown>>;
      }
      return {
        id: raw.id, repo: raw.repo, status: raw.status, goal: raw.goal,
        branch: raw.branch, pr: raw.pr, createdAt: raw.created_at,
        updatedAt: raw.updated_at, finishedAt: raw.finished_at,
        riskScore: raw.risk_score, events: raw.events ?? [],
      }
    } catch {
      // Task not found, or CLI failure.  The bridge surfaces "not found" as null
      // so callers can distinguish "still propagating" from a real error during polling.
      return null
    }
  }

  /**
   * Read evidence files for a Python task from `<homeDir>/workspaces/<taskId>/.evidence/`.
   * Returns a record of filename → contents (utf-8).  Missing dir returns empty record.
   */
  async readEvidence(taskId: string): Promise<Record<string, string>> {
    const evidenceDir = join(this.home, 'workspaces', taskId, '.evidence')
    if (!existsSync(evidenceDir)) return {}
    const out: Record<string, string> = {}
    for (const entry of readdirSync(evidenceDir)) {
      const full = join(evidenceDir, entry)
      try {
        if (statSync(full).isFile()) {
          out[entry] = readFileSync(full, 'utf-8')
        }
      } catch {
        // skip unreadable entries
      }
    }
    return out
  }

  /** Expose the configured home dir so consumers can locate auxiliary paths. */
  getHomeDir(): string {
    return this.home
  }
}
