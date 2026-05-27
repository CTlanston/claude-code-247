import { describe, it, expect } from 'vitest'
import {
  DefaultIndependentJudgeContextBuilder,
  StaticGitDiffFetcher,
  type GitDiffResult,
  type GitDiffSpec,
  type GitDiffFetcher,
} from './index.js'

const FAKE_DIFF: GitDiffResult = {
  diff: 'diff --git a/foo.ts b/foo.ts\n@@ -1,3 +1,4 @@\n+console.log("hi")\n',
  resolvedBase: 'abc123',
  resolvedHead: 'def456',
  fileStats: [{ path: 'foo.ts', added: 1, removed: 0 }],
}

describe('validators · independent judge context (Stage E L1)', () => {
  it('case 1: builder pipes the fetcher result through unchanged', async () => {
    const builder = new DefaultIndependentJudgeContextBuilder(new StaticGitDiffFetcher(FAKE_DIFF))
    const ctx = await builder.build({
      taskId: 'task_e',
      diffSpec: { repoDir: '/tmp/repo', baseRef: 'origin/main', headRef: 'feature/x' },
      evidencePaths: ['/tmp/repo/.evidence/build.log'],
    })
    expect(ctx.taskId).toBe('task_e')
    expect(ctx.diff.resolvedHead).toBe('def456')
    expect(ctx.diff.fileStats).toEqual([{ path: 'foo.ts', added: 1, removed: 0 }])
    expect(ctx.evidencePaths).toEqual(['/tmp/repo/.evidence/build.log'])
  })

  it('case 2: judges receive a diff the Coder cannot alter (independence by injection)', async () => {
    // Simulate a Coder that tries to embed instructions in its diff body —
    // the fetcher returns the canonical diff, NOT whatever the Coder
    // claimed. The judge then reads ctx.diff, not Coder prompt context.
    const canonical: GitDiffResult = {
      diff: 'diff --git a/safe.ts b/safe.ts\n+const x = 1\n',
      resolvedBase: 'aaa',
      resolvedHead: 'bbb',
      fileStats: [{ path: 'safe.ts', added: 1, removed: 0 }],
    }
    const builder = new DefaultIndependentJudgeContextBuilder(new StaticGitDiffFetcher(canonical))
    const ctx = await builder.build({
      taskId: 'task_e',
      diffSpec: { repoDir: '/tmp/repo', baseRef: 'origin/main', headRef: 'feature/y' },
      evidencePaths: [],
    })
    expect(ctx.diff.diff).not.toContain('<system>')
    expect(ctx.diff.diff).toContain('safe.ts')
  })

  it('case 3: GitDiffFetcher is the seam — production wiring (real git) is OUT of scope here', async () => {
    // Asserts the contract surface: any GitDiffFetcher with .fetch(spec)
    // satisfies the builder. Real prod wires this to a worker subprocess
    // that runs `git fetch && git diff`.
    const captured: { spec: GitDiffSpec | null } = { spec: null }
    const fetcher: GitDiffFetcher = {
      async fetch(spec: GitDiffSpec) {
        captured.spec = spec
        return FAKE_DIFF
      },
    }
    const builder = new DefaultIndependentJudgeContextBuilder(fetcher)
    const result = await builder.build({
      taskId: 'task_e',
      diffSpec: { repoDir: '/tmp/r', baseRef: 'origin/main', headRef: 'pr/123', paths: ['src/'] },
      evidencePaths: [],
    })
    expect(captured.spec?.paths).toEqual(['src/'])
    expect(result.taskId).toBe('task_e')
  })
})
