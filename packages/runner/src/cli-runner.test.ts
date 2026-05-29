import { execFileSync } from 'child_process'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { RunnerConfig, Task } from '@aedev/core'
import { LocalCliRunner } from './cli-runner.js'

let root: string
let sourceRepo: string
let worktrees: string
let evidence: string

beforeEach(() => {
  root = join(tmpdir(), `aedev-cli-runner-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  sourceRepo = join(root, 'source repo with spaces')
  worktrees = join(root, 'worktrees')
  evidence = join(root, 'evidence')
  mkdirSync(sourceRepo, { recursive: true })
  execFileSync('git', ['init', '-q'], { cwd: sourceRepo })
  writeFileSync(join(sourceRepo, 'README.md'), '# Fixture\n')
  execFileSync('git', ['add', 'README.md'], { cwd: sourceRepo })
  execFileSync('git', ['-c', 'user.name=test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'init'], { cwd: sourceRepo })
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('LocalCliRunner', () => {
  it('runs in a safe clone, executes objective gates, and creates a local commit', async () => {
    const runner = new LocalCliRunner('claude', {
      async runClaude(_prompt, workdir) {
        writeFileSync(join(workdir, 'README.md'), '# Fixture\n\nV2.4 slice note.\n')
        return {
          transcript: 'PLAN -> IMPLEMENT -> self-review complete',
          exitCode: 0,
          durationMs: 10,
          authMode: 'local_claude_code',
          costUsd: null,
          inputTokens: 12,
          outputTokens: 34,
          rawJson: { result: 'ok', usage: { input_tokens: 12, output_tokens: 34 } },
        }
      },
    })
    const result = await runner.run(task(), config({
      testCommands: ['test -f README.md'],
      createLocalCommit: true,
    }))

    expect(result.exitCode).toBe(0)
    const dir = result.evidenceDir
    expect(readFileSync(join(dir, 'changed-paths.json'), 'utf8')).toContain('README.md')
    expect(readFileSync(join(dir, 'objective-gates.json'), 'utf8')).toContain('"ok": true')
    expect(readFileSync(join(dir, 'local-commit.json'), 'utf8')).toContain('"created": true')
    expect(readFileSync(join(dir, 'model-usage.json'), 'utf8')).toContain('"inputTokens": 12')
  })

  it('fails the final gate on forbidden-path edits without pushing anywhere', async () => {
    const runner = new LocalCliRunner('claude', {
      async runClaude(_prompt, workdir) {
        writeFileSync(join(workdir, '.env'), 'TOKEN=nope\n')
        return {
          transcript: 'wrote forbidden file',
          exitCode: 0,
          durationMs: 10,
          authMode: 'local_claude_code',
          costUsd: null,
          inputTokens: 1,
          outputTokens: 2,
          rawJson: {},
        }
      },
    })
    const result = await runner.run(task(), config({ forbiddenPaths: ['.env*'] }))

    expect(result.exitCode).toBe(1)
    expect(readFileSync(join(result.evidenceDir, 'changed-paths.json'), 'utf8')).toContain('.env')
  })
})

function task(): Task {
  return {
    id: 'task-1',
    missionId: 'mission-1',
    repoId: 'repo-1',
    title: 'T',
    prompt: 'Do the smallest safe thing',
    status: 'pending',
    attemptNumber: 1,
    createdAt: '',
    updatedAt: '',
  }
}

function config(overrides: Partial<RunnerConfig> = {}): RunnerConfig {
  return {
    mode: 'claude-cli',
    maxConcurrentWorkers: 1,
    worktreeBaseDir: worktrees,
    outputBaseDir: evidence,
    sourceRepoPath: sourceRepo,
    testCommands: [],
    forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    branchPrefix: 'test-v24',
    ...overrides,
  }
}
