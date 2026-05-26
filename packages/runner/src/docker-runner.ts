import { spawn, execFile } from 'child_process'
import { promisify } from 'util'
import { join } from 'path'
import { mkdirSync, writeFileSync } from 'fs'
import type { Task, RunnerConfig, RunResult } from '@aedev/core'
import { generateId } from '@aedev/core'
import type { RunnerInterface } from './runner-interface.js'

const execFileAsync = promisify(execFile)

/**
 * Launches a Docker container with the task's worktree and evidence
 * directory mounted, captures stdout/stderr/exit-code, enforces a timeout,
 * and writes captured logs to the evidence directory.
 *
 * Per ADR-0009, this is a low-level "run a container with mounts" primitive.
 * The container image must already exist on the host (this runner does not
 * build images).  During the parity window, missions that need a full
 * coding-worker container are routed through `@aedev/claude247-bridge` to
 * the Python kernel, which uses its own worker image.
 */
export interface DockerRunnerOptions {
  /** Override the docker CLI binary. Defaults to `docker`. */
  dockerBin?: string
  /** Container image. Defaults to env `AEDEV_DOCKER_IMAGE`, then `alpine:3.20`. */
  image?: string
  /** Command to exec inside the container. Defaults to a smoke command that writes evidence. */
  command?: string[]
  /** Wall-clock timeout for the docker process. Defaults to 10 minutes. */
  timeoutMs?: number
  /** Extra env vars passed to the container via `-e KEY=VALUE`. */
  env?: Record<string, string>
}

const DEFAULT_TIMEOUT_MS = 600_000 // 10 minutes
const DEFAULT_IMAGE_FALLBACK = 'alpine:3.20'

export class DockerRunner implements RunnerInterface {
  constructor(private readonly opts: DockerRunnerOptions = {}) {}

  /** Returns true iff `docker info` succeeds within 5 seconds. */
  async isDockerAvailable(): Promise<boolean> {
    const bin = this.opts.dockerBin ?? 'docker'
    try {
      await execFileAsync(bin, ['info'], { timeout: 5000 })
      return true
    } catch {
      return false
    }
  }

  async run(task: Task, config: RunnerConfig): Promise<RunResult> {
    const start = Date.now()
    const runId = generateId()
    const workdir = join(config.worktreeBaseDir, task.id)
    const evidenceDir = join(config.outputBaseDir, task.id)
    mkdirSync(workdir, { recursive: true })
    mkdirSync(evidenceDir, { recursive: true })

    const dockerBin = this.opts.dockerBin ?? 'docker'
    const image = this.opts.image ?? process.env['AEDEV_DOCKER_IMAGE'] ?? DEFAULT_IMAGE_FALLBACK
    const timeoutMs = this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS
    const command = this.opts.command ?? [
      'sh', '-c',
      'echo "aedev DockerRunner: task ${TASK_ID} run ${AEDEV_RUN_ID}" > /aedev-output/done.txt; date >> /aedev-output/done.txt',
    ]

    const dockerArgs: string[] = [
      'run', '--rm',
      '-v', `${workdir}:/aedev-workdir:rw`,
      '-v', `${evidenceDir}:/aedev-output:rw`,
      '-w', '/aedev-workdir',
      '-e', `TASK_ID=${task.id}`,
      '-e', `AEDEV_RUN_ID=${runId}`,
    ]
    if (this.opts.env) {
      for (const [k, v] of Object.entries(this.opts.env)) {
        dockerArgs.push('-e', `${k}=${v}`)
      }
    }
    dockerArgs.push(image, ...command)

    const { exitCode, stdout, stderr, timedOut, spawnError } = await spawnDocker(dockerBin, dockerArgs, timeoutMs)

    writeFileSync(join(evidenceDir, 'stdout.log'), stdout)
    writeFileSync(join(evidenceDir, 'stderr.log'), stderr)
    writeFileSync(
      join(evidenceDir, 'docker-meta.json'),
      JSON.stringify(
        { runId, taskId: task.id, image, command, args: dockerArgs, timedOut, exitCode, spawnError },
        null,
        2,
      ),
    )

    return {
      runId,
      taskId: task.id,
      exitCode: timedOut ? 124 : exitCode,
      evidenceDir,
      durationMs: Date.now() - start,
    }
  }
}

interface DockerSpawnResult {
  exitCode: number
  stdout: string
  stderr: string
  timedOut: boolean
  spawnError?: string
}

async function spawnDocker(bin: string, args: string[], timeoutMs: number): Promise<DockerSpawnResult> {
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let timedOut = false
    let settled = false

    const child = spawn(bin, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
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
      // Kill the whole process group — `sh -c "sleep 5"` and similar leave
      // grandchildren holding the stdio pipes open if we only signal sh.
      killGroup('SIGTERM')
      killTimer = setTimeout(() => {
        if (!settled) killGroup('SIGKILL')
      }, 500)
    }, timeoutMs)

    child.stdout?.on('data', (d: Buffer) => { stdout += d.toString() })
    child.stderr?.on('data', (d: Buffer) => { stderr += d.toString() })

    const settle = (r: DockerSpawnResult): void => {
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
