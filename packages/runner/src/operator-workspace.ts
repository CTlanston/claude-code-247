import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, rmSync } from 'fs'
import { join } from 'path'
import type { Repo } from '@aedev/core'

const execFileAsync = promisify(execFile)

/**
 * Repo-bound worker workspace (Operator Cockpit P0 trust fix).
 *
 * The worker MUST execute inside an isolated git worktree of the operator's
 * selected repo — never an empty scratch directory.  If the target repo is
 * missing, disabled, or not a git repository we HOLD (`HOLD-TARGET-REPO-UNAVAILABLE`)
 * instead of letting the worker write throwaway files and report "done".
 *
 * `git worktree add --detach` isolates the worker on the repo's committed HEAD:
 * the worker edits real repository files, but the operator's working tree and
 * branches are untouched, and `git status`/`diff` in the worktree report the
 * worker's real changes.  All git invocation goes through an injectable
 * `GitExec` so this is unit-testable against a real temp repo with no live CLI.
 */

export type GitExec = (args: string[], cwd?: string) => Promise<{ stdout: string; exitCode: number }>

const defaultGitExec: GitExec = async (args, cwd) => {
  try {
    const { stdout } = await execFileAsync('git', args, { ...(cwd ? { cwd } : {}), timeout: 60_000, maxBuffer: 16 * 1024 * 1024 })
    return { stdout: stdout.toString(), exitCode: 0 }
  } catch (e) {
    const err = e as { code?: number; stdout?: string | Buffer }
    return { stdout: err.stdout?.toString() ?? '', exitCode: typeof err.code === 'number' ? err.code : 1 }
  }
}

export const TARGET_REPO_HOLD = 'HOLD-TARGET-REPO-UNAVAILABLE'

export class TargetRepoUnavailableError extends Error {
  readonly code = TARGET_REPO_HOLD
  constructor(message: string) {
    super(message)
    this.name = 'TargetRepoUnavailableError'
  }
}

export type RepoPreflight =
  | { ok: true; topLevel: string }
  | { ok: false; code: typeof TARGET_REPO_HOLD; reason: string }

/** Validate that a repo is a real, enabled, on-disk git repository. */
export async function validateTargetRepo(repo: Repo | undefined, gitExec: GitExec = defaultGitExec): Promise<RepoPreflight> {
  if (!repo) return { ok: false, code: TARGET_REPO_HOLD, reason: 'mission has no target repo registered' }
  if (!repo.enabled) return { ok: false, code: TARGET_REPO_HOLD, reason: `target repo "${repo.name}" is disabled in the registry` }
  if (!repo.path || !existsSync(repo.path)) {
    return { ok: false, code: TARGET_REPO_HOLD, reason: `target repo path does not exist: ${repo.path || '(empty)'}` }
  }
  const top = await gitExec(['-C', repo.path, 'rev-parse', '--show-toplevel'])
  if (top.exitCode !== 0) return { ok: false, code: TARGET_REPO_HOLD, reason: `target repo path is not a git repository: ${repo.path}` }
  const head = await gitExec(['-C', repo.path, 'rev-parse', 'HEAD'])
  if (head.exitCode !== 0 || !head.stdout.trim()) {
    return { ok: false, code: TARGET_REPO_HOLD, reason: `target repo "${repo.name}" has no commits yet (unborn HEAD): ${repo.path}` }
  }
  return { ok: true, topLevel: top.stdout.trim() }
}

export interface RepoBoundWorkspace {
  /** Absolute path of the isolated worktree the worker runs inside. */
  worktreePath: string
  /** The repo HEAD the worktree was checked out from. */
  baseSha: string
  /** True when the operator's source working tree had uncommitted changes (worker runs on HEAD, not WIP). */
  dirty: boolean
}

/**
 * Create an isolated git worktree of `repo` for `taskId`.  Throws
 * `TargetRepoUnavailableError` when the repo is invalid or the worktree cannot
 * be created — the caller turns that into a HOLD, never a silent success.
 */
export async function createRepoBoundWorkspace(
  repo: Repo,
  taskId: string,
  stateDir: string,
  gitExec: GitExec = defaultGitExec,
): Promise<RepoBoundWorkspace> {
  const preflight = await validateTargetRepo(repo, gitExec)
  if (!preflight.ok) throw new TargetRepoUnavailableError(preflight.reason)

  const root = join(stateDir, 'operator-workspaces', taskId)
  const worktreePath = join(root, 'repo')

  // A retried task id may have a stale worktree registered — detach it first.
  if (existsSync(worktreePath)) {
    await gitExec(['-C', repo.path, 'worktree', 'remove', '--force', worktreePath])
    rmSync(worktreePath, { recursive: true, force: true })
  }
  await gitExec(['-C', repo.path, 'worktree', 'prune'])
  mkdirSync(root, { recursive: true })

  const baseSha = (await gitExec(['-C', repo.path, 'rev-parse', 'HEAD'])).stdout.trim()
  const dirty = (await gitExec(['-C', repo.path, 'status', '--porcelain=v1'])).stdout.trim().length > 0

  const add = await gitExec(['-C', repo.path, 'worktree', 'add', '--detach', worktreePath, baseSha || 'HEAD'])
  if (add.exitCode !== 0 || !existsSync(worktreePath)) {
    throw new TargetRepoUnavailableError(`git worktree add failed for ${repo.path}: ${add.stdout.trim() || `exit ${add.exitCode}`}`)
  }
  return { worktreePath, baseSha, dirty }
}

/** Remove the worktree after a run (best-effort; never throws). */
export async function removeRepoBoundWorkspace(repoPath: string, worktreePath: string, gitExec: GitExec = defaultGitExec): Promise<void> {
  try {
    await gitExec(['-C', repoPath, 'worktree', 'remove', '--force', worktreePath])
  } catch { /* best effort */ }
  rmSync(worktreePath, { recursive: true, force: true })
}

export interface WorkspaceDiff {
  changedPaths: string[]
  forbiddenHits: string[]
  /** Human-readable diff summary for the evidence bundle. */
  summary: string
}

/** Scratch/context files the runner places in the worktree that are NOT worker changes. */
const HARNESS_FILES = new Set(['mission.md'])

/** Collect the worker's real repository changes from the worktree (committed + uncommitted). */
export async function collectWorkspaceDiff(
  worktreePath: string,
  baseSha: string,
  forbiddenPaths: string[],
  gitExec: GitExec = defaultGitExec,
): Promise<WorkspaceDiff> {
  const committed = baseSha
    ? (await gitExec(['-C', worktreePath, 'diff', '--name-only', `${baseSha}..HEAD`])).stdout.split('\n')
    : []
  const porcelain = (await gitExec(['-C', worktreePath, 'status', '--porcelain=v1'])).stdout.split('\n')
  const uncommitted = porcelain.filter((l) => l.length > 0).map((l) => l.slice(3).replace(/^"|"$/g, ''))
  const changedPaths = [...new Set([...committed, ...uncommitted].filter(Boolean))]
    .filter((p) => !HARNESS_FILES.has(p))
    .sort()
  const forbiddenHits = changedPaths.filter((p) => forbiddenPaths.some((pat) => pathMatches(pat, p)))
  const stat = baseSha ? (await gitExec(['-C', worktreePath, 'diff', '--stat', `${baseSha}..HEAD`])).stdout.trim() : ''
  const summary = [
    '# Diff Summary',
    '',
    `Worktree: ${worktreePath}`,
    `Base commit: ${baseSha || '(none)'}`,
    '',
    'Changed repository files:',
    changedPaths.length ? changedPaths.map((p) => `- ${p}`).join('\n') : '- (none — the worker made no repository changes)',
    '',
    forbiddenHits.length ? `⚠ Forbidden-path hits: ${forbiddenHits.join(', ')}` : 'Forbidden-path scan: PASS',
    '',
    stat ? ['Committed diffstat:', '```', stat, '```'].join('\n') : '',
    '',
    'Note: a non-empty diff is the expected success signal, not a failure. `git diff --exit-code` returns 1 when changes exist; that is normal and is not a test failure.',
  ].filter((l) => l !== '').join('\n') + '\n'
  return { changedPaths, forbiddenHits, summary }
}

/** Glob matcher for forbidden-path patterns (mirrors cli-runner / mission-runner). */
export function pathMatches(pattern: string, path: string): boolean {
  if (pattern.endsWith('/**')) return path === pattern.slice(0, -3) || path.startsWith(pattern.slice(0, -3) + '/')
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1))
  return path === pattern
}
