import { execFile } from 'child_process'
import { promisify } from 'util'
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { RunnerConfig, RunResult, Task } from '@aedev/core'
import { generateId } from '@aedev/core'
import { ClaudeCodeAdapter, type ClaudeRunResult } from './claude-adapter.js'
import { CodexCliAdapter, type CodexRunResult } from './codex-adapter.js'
import type { RunnerInterface } from './runner-interface.js'

export type LocalCliKind = 'claude' | 'codex'
type LocalCliResult = ClaudeRunResult | CodexRunResult

export interface LocalCliRunnerOptions {
  runClaude?: (prompt: string, workdir: string, options: Parameters<ClaudeCodeAdapter['run']>[2]) => Promise<ClaudeRunResult>
  runCodex?: (prompt: string, workdir: string, options: Parameters<CodexCliAdapter['run']>[2]) => Promise<CodexRunResult>
}

const execFileAsync = promisify(execFile)

export class LocalCliRunner implements RunnerInterface {
  constructor(private readonly kind: LocalCliKind, private readonly opts: LocalCliRunnerOptions = {}) {}

  async run(task: Task, config: RunnerConfig): Promise<RunResult> {
    const started = Date.now()
    const runId = generateId()
    const workdir = join(config.worktreeBaseDir, task.id)
    const evidenceDir = join(config.outputBaseDir, task.id)
    mkdirSync(evidenceDir, { recursive: true })
    await prepareWorktree(workdir, config)
    const baseSha = await currentHead(workdir)

    const prompt = [
      task.prompt,
      '',
      'Run PLAN -> IMPLEMENT -> self-review inside this worktree.',
      'Do not push to GitHub. Do not merge. Do not add or rely on .skip tests.',
      'Do not edit .env*, secrets/**, .github/**, AGENTS.md, or other configured forbidden paths.',
      'Leave concise evidence in markdown: plan, changed files, tests/checks, self-review, and done report.',
    ].join('\n')

    const result: LocalCliResult = this.kind === 'claude'
      ? await (this.opts.runClaude ?? ((p, cwd, o) => new ClaudeCodeAdapter().run(p, cwd, o)))(prompt, workdir, {})
      : await (this.opts.runCodex ?? ((p, cwd, o) => new CodexCliAdapter().run(p, cwd, o)))(prompt, workdir, {})

    const workerChangedPaths = await listChangedPaths(workdir, baseSha)
    const gate = await runObjectiveGates(workdir, config)
    const changedPaths = await listChangedPaths(workdir, baseSha)
    const gateByproductPaths = changedPaths.filter((path) => !workerChangedPaths.includes(path))
    const forbiddenHits = changedPaths.filter((path) => (config.forbiddenPaths ?? []).some((pattern) => pathMatches(pattern, path)))
    await revertUncommittedPaths(workdir, gateByproductPaths)
    const commit = config.createLocalCommit === false
      ? { attempted: false, created: false, sha: null, reason: 'disabled' }
      : await createLocalCommit(workdir, config, workerChangedPaths, baseSha)

    const finalExitCode = result.exitCode !== 0 || !gate.ok || forbiddenHits.length > 0 ? 1 : 0

    writeFileSync(join(evidenceDir, 'transcript-summary.md'), result.transcript || '(no transcript)')
    writeFileSync(join(evidenceDir, `${this.kind}-raw.json`), JSON.stringify(result.rawJson, null, 2))
    writeFileSync(join(evidenceDir, 'objective-gates.json'), JSON.stringify(gate, null, 2))
    writeFileSync(join(evidenceDir, 'changed-paths.json'), JSON.stringify({ changedPaths, workerChangedPaths, gateByproductPaths, forbiddenHits }, null, 2))
    writeFileSync(join(evidenceDir, 'local-commit.json'), JSON.stringify(commit, null, 2))
    writeFileSync(join(evidenceDir, 'model-usage.json'), JSON.stringify({
      provider: `${this.kind}-cli`,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: result.costUsd,
      durationMs: result.durationMs,
    }, null, 2))
    writeFileSync(join(evidenceDir, 'diff-summary.md'), [
      '# Diff Summary',
      '',
      changedPaths.length ? changedPaths.map((p) => `- ${p}`).join('\n') : 'No changed paths were detected.',
      '',
      workerChangedPaths.length ? `Worker changed paths:\n${workerChangedPaths.map((p) => `- ${p}`).join('\n')}` : 'Worker changed paths: none',
      '',
      gateByproductPaths.length ? `Gate byproduct paths:\n${gateByproductPaths.map((p) => `- ${p}`).join('\n')}` : 'Gate byproduct paths: none',
      '',
      forbiddenHits.length ? `Forbidden path hits:\n${forbiddenHits.map((p) => `- ${p}`).join('\n')}` : 'Forbidden path scan: PASS',
      '',
      `Local commit: ${commit.created ? commit.sha : commit.reason}`,
    ].join('\n'))
    writeFileSync(join(evidenceDir, 'test-summary.md'), [
      '# Test Summary',
      '',
      ...gate.results.flatMap((r) => [
        `## ${r.name}`,
        `Exit code: ${r.exitCode}`,
        '```',
        `${r.stdout}${r.stderr ? `\nSTDERR:\n${r.stderr}` : ''}`.trim() || '(no output)',
        '```',
        '',
      ]),
      gate.results.length === 0 ? 'No objective gate command was discovered or supplied.' : '',
      `Worker exit code: ${result.exitCode}`,
      `Final exit code: ${finalExitCode}`,
      result.error ? `Error: ${result.error}` : '',
    ].filter(Boolean).join('\n'))
    writeFileSync(join(evidenceDir, 'plan.md'), [
      '# Plan',
      '',
      result.transcript || '(worker did not return a transcript)',
    ].join('\n'))
    writeFileSync(join(evidenceDir, 'done-report.md'), [
      '# Done Report',
      '',
      `Task: ${task.id}`,
      `Runner: ${this.kind}`,
      `Worker exit code: ${result.exitCode}`,
      `Final exit code: ${finalExitCode}`,
      `Worktree: ${workdir}`,
      `Evidence: ${evidenceDir}`,
    ].join('\n'))

    return {
      runId,
      taskId: task.id,
      exitCode: finalExitCode,
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

async function runObjectiveGates(workdir: string, config: RunnerConfig): Promise<{
  ok: boolean
  results: Array<{ name: string; command: string; exitCode: number; stdout: string; stderr: string }>
}> {
  const commands = discoverGateCommands(workdir, config)
  const results = []
  for (const command of commands) {
    const result = await runShell(command, workdir)
    results.push({ name: command, command, ...result })
  }
  return { ok: results.every((r) => r.exitCode === 0), results }
}

function discoverGateCommands(workdir: string, config: RunnerConfig): string[] {
  const commands = [...(config.testCommands ?? [])]
  if (commands.length === 0 && existsSync(join(workdir, 'validate.sh'))) commands.push('./validate.sh')
  const alreadyRunsAudit = commands.some((command) => /validate\.sh|audit_multi_round|audit:multi-round/.test(command))
  if (!alreadyRunsAudit && existsSync(join(workdir, 'scripts', 'audit_multi_round.js'))) commands.push('node scripts/audit_multi_round.js')
  return commands
}

async function runShell(command: string, cwd: string): Promise<{ exitCode: number; stdout: string; stderr: string }> {
  try {
    const out = await execFileAsync('/bin/sh', ['-lc', command], { cwd, timeout: 300_000, maxBuffer: 20 * 1024 * 1024 })
    return { exitCode: 0, stdout: out.stdout, stderr: out.stderr }
  } catch (e) {
    const err = e as { code?: number; stdout?: string; stderr?: string; message?: string }
    return {
      exitCode: typeof err.code === 'number' ? err.code : 1,
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
    }
  }
}

async function listChangedPaths(workdir: string, baseSha: string | null = null): Promise<string[]> {
  if (!existsSync(join(workdir, '.git'))) return []
  const committed = baseSha
    ? (await execFileAsync('git', ['diff', '--name-only', `${baseSha}..HEAD`], { cwd: workdir, timeout: 30_000 })).stdout.split('\n')
    : []
  const out = await execFileAsync('git', ['status', '--porcelain=v1'], { cwd: workdir, timeout: 30_000 })
  const uncommitted = out.stdout.split('\n')
    .filter((line) => line.length > 0)
    .map((line) => line.slice(3).replace(/^"|"$/g, ''))
  return [...new Set([...committed, ...uncommitted].filter(Boolean))]
    .sort()
}

async function createLocalCommit(workdir: string, config: RunnerConfig, changedPaths: string[], baseSha: string | null): Promise<{
  attempted: boolean
  created: boolean
  sha: string | null
  branch?: string
  reason?: string
}> {
  if (!existsSync(join(workdir, '.git'))) return { attempted: true, created: false, sha: null, reason: 'worktree is not a git repository' }
  const head = await currentHead(workdir)
  if (baseSha && head && head !== baseSha) {
    return { attempted: true, created: true, sha: head, branch: (await currentBranch(workdir)) ?? undefined, reason: 'worker already created a local commit' }
  }
  if (changedPaths.length === 0) return { attempted: true, created: false, sha: null, reason: 'no changes' }
  const branch = `${config.branchPrefix ?? 'v24-slice'}/${Date.now()}`
  await execFileAsync('git', ['switch', '-c', branch], { cwd: workdir, timeout: 30_000 })
  await execFileAsync('git', ['add', '--', ...changedPaths], { cwd: workdir, timeout: 30_000 })
  await execFileAsync('git', [
    '-c', 'user.name=claude-code-247',
    '-c', 'user.email=claude-code-247@example.invalid',
    'commit',
    '-m', '[V2.4-S0] local vertical slice worker output',
  ], { cwd: workdir, timeout: 60_000 })
  const sha = (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workdir, timeout: 30_000 })).stdout.trim()
  return { attempted: true, created: true, sha, branch }
}

async function revertUncommittedPaths(workdir: string, paths: string[]): Promise<void> {
  if (paths.length === 0 || !existsSync(join(workdir, '.git'))) return
  try {
    await execFileAsync('git', ['checkout', '--', ...paths], { cwd: workdir, timeout: 30_000 })
  } catch {
    // Best effort only: paths may be untracked or already committed by the worker.
  }
  try {
    await execFileAsync('git', ['clean', '-f', '--', ...paths], { cwd: workdir, timeout: 30_000 })
  } catch {
    // Best effort only.
  }
}

async function currentHead(workdir: string): Promise<string | null> {
  if (!existsSync(join(workdir, '.git'))) return null
  try {
    return (await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd: workdir, timeout: 30_000 })).stdout.trim()
  } catch {
    return null
  }
}

async function currentBranch(workdir: string): Promise<string | null> {
  try {
    return (await execFileAsync('git', ['branch', '--show-current'], { cwd: workdir, timeout: 30_000 })).stdout.trim() || null
  } catch {
    return null
  }
}

function pathMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/**')) return path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -3) + '/')
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1))
  return path === pattern
}
