/**
 * Prototype guard tests.
 *
 * These tests prove that placeholder TypeScript runner implementations throw
 * a typed ExperimentalFeatureError — never silently succeed.  They must
 * continue to pass until the real Docker / Claude Code adapter implementations
 * land (at which point these tests should be removed and replaced with real
 * integration tests).
 */
import { describe, it, expect, afterEach } from 'vitest'
import { ExperimentalFeatureError } from '@aedev/core'
import { DockerRunner } from './docker-runner.js'
import { ClaudeCodeAdapter } from './claude-adapter.js'
import type { Task, RunnerConfig } from '@aedev/core'

const stubTask: Task = {
  id: 'task-001',
  missionId: 'mission-001',
  repoId: 'repo-001',
  title: 'Test task',
  prompt: 'Do something for testing purposes',
  status: 'pending',
  attemptNumber: 1,
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
}

const stubConfig: RunnerConfig = {
  mode: 'docker',
  maxConcurrentWorkers: 1,
  worktreeBaseDir: '/tmp/aedev/worktrees',
  outputBaseDir: '/tmp/aedev/output',
}

describe('DockerRunner — prototype guard', () => {
  const savedEnv = process.env['AEDEV_DOCKER_RUNNER']

  afterEach(() => {
    if (savedEnv === undefined) delete process.env['AEDEV_DOCKER_RUNNER']
    else process.env['AEDEV_DOCKER_RUNNER'] = savedEnv
  })

  it('throws ExperimentalFeatureError when flag is not set', async () => {
    delete process.env['AEDEV_DOCKER_RUNNER']
    const runner = new DockerRunner()
    await expect(runner.run(stubTask, stubConfig)).rejects.toBeInstanceOf(ExperimentalFeatureError)
  })

  it('throws ExperimentalFeatureError even when flag is set (not yet implemented)', async () => {
    process.env['AEDEV_DOCKER_RUNNER'] = '1'
    const runner = new DockerRunner()
    await expect(runner.run(stubTask, stubConfig)).rejects.toBeInstanceOf(ExperimentalFeatureError)
  })

  it('error message identifies the feature', async () => {
    delete process.env['AEDEV_DOCKER_RUNNER']
    const runner = new DockerRunner()
    const err = await runner.run(stubTask, stubConfig).catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ExperimentalFeatureError)
    expect((err as ExperimentalFeatureError).feature).toBe('DockerRunner')
    expect((err as ExperimentalFeatureError).name).toBe('ExperimentalFeatureError')
  })
})

describe('ClaudeCodeAdapter — prototype guard', () => {
  it('throws ExperimentalFeatureError', async () => {
    const adapter = new ClaudeCodeAdapter()
    await expect(adapter.run('do something', '/tmp')).rejects.toBeInstanceOf(ExperimentalFeatureError)
  })

  it('error message identifies the feature', async () => {
    const adapter = new ClaudeCodeAdapter()
    const err = await adapter.run('prompt', '/tmp').catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ExperimentalFeatureError)
    expect((err as ExperimentalFeatureError).feature).toBe('ClaudeCodeAdapter.run')
    expect((err as ExperimentalFeatureError).name).toBe('ExperimentalFeatureError')
  })
})
