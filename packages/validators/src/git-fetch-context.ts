/** Stage E — Judges 独立 git fetch.
 *
 * Workbook §3 Stage E: "judges 改为独立 git fetch 读 PR diff" — judges
 * must NOT be handed the diff as part of the Coder's prompt context.
 * They run their own `git fetch` + `git diff` against the named SHAs.
 * This prevents the Coder from selectively narrating the diff to the
 * judges (red-team round 1 attack surface).
 *
 * This module is the contract surface. The actual git invocation is
 * injected (`GitDiffFetcher`) so tests don't fork a real `git`. The
 * production binding lives in @aedev/runner / a worker subprocess —
 * never the daemon (GROUND RULE 8).
 */

export interface GitDiffSpec {
  /** Repo working directory (clone path the runner controls). */
  repoDir: string
  /** Base ref the PR is merging into (e.g., 'origin/main'). */
  baseRef: string
  /** Head ref / SHA the PR introduces. */
  headRef: string
  /** Optional path filter (limit diff to specific paths). */
  paths?: readonly string[]
}

export interface GitDiffResult {
  /** The raw unified diff text. Never blank when the diff is non-empty. */
  diff: string
  /** SHAs we actually compared, after `git rev-parse`. */
  resolvedBase: string
  resolvedHead: string
  /** Per-file changed-line counts; the judge can use this to bound scope. */
  fileStats: ReadonlyArray<{ path: string; added: number; removed: number }>
}

export interface GitDiffFetcher {
  fetch(spec: GitDiffSpec): Promise<GitDiffResult>
}

/**
 * Composed judge context: just enough for a judge to render its verdict
 * without ever seeing the Coder's prompt or the Coder's narration.
 */
export interface IndependentJudgeContext {
  taskId: string
  /** The diff the judge inspects — fetched independently. */
  diff: GitDiffResult
  /** Evidence files the runner wrote (test logs, screenshots) — these
   *  are filesystem artefacts the Coder doesn't get to redact. */
  evidencePaths: readonly string[]
}

export interface IndependentJudgeContextBuilder {
  build(args: {
    taskId: string
    diffSpec: GitDiffSpec
    evidencePaths: readonly string[]
  }): Promise<IndependentJudgeContext>
}

/** Default builder: drives the injected GitDiffFetcher. */
export class DefaultIndependentJudgeContextBuilder implements IndependentJudgeContextBuilder {
  constructor(private readonly fetcher: GitDiffFetcher) {}

  async build(args: {
    taskId: string
    diffSpec: GitDiffSpec
    evidencePaths: readonly string[]
  }): Promise<IndependentJudgeContext> {
    const diff = await this.fetcher.fetch(args.diffSpec)
    return {
      taskId: args.taskId,
      diff,
      evidencePaths: args.evidencePaths,
    }
  }
}

/** Test/in-memory fetcher — returns whatever you give it. */
export class StaticGitDiffFetcher implements GitDiffFetcher {
  constructor(private readonly result: GitDiffResult) {}
  async fetch(_spec: GitDiffSpec): Promise<GitDiffResult> {
    void _spec
    return this.result
  }
}
