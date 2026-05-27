/**
 * Real-behavior tests for DockerRunner.
 *
 * The unit tests use a fake `docker` binary written to a temp directory so
 * the runner's argv shape, env handling, timeout enforcement, and evidence
 * writing are all exercised without requiring a real Docker daemon.
 *
 * The opt-in smoke tests at the bottom invoke the real `docker` CLI against
 * `alpine:3.20` when `AEDEV_SMOKE_DOCKER=1` is set.  They are skipped by
 * default.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { writeFileSync, chmodSync, mkdtempSync, rmSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { DockerRunner } from './docker-runner.js'
import type { Task, RunnerConfig } from '@aedev/core'

let tmpRoot: string
let fakeDockerOk: string
let fakeDockerErr: string
let fakeDockerSlow: string

function makeTask(id = 'task-001'): Task {
  return {
    id,
    missionId: 'mission-001',
    repoId: 'repo-001',
    title: 'Test task',
    prompt: 'Do something',
    status: 'pending',
    attemptNumber: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
}

function makeConfig(root: string): RunnerConfig {
  return {
    mode: 'docker',
    maxConcurrentWorkers: 1,
    worktreeBaseDir: join(root, 'worktrees'),
    outputBaseDir: join(root, 'output'),
  }
}

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), 'aedev-docker-runner-test-'))

  // Fake docker that succeeds and echoes its argv to stderr.
  fakeDockerOk = join(tmpRoot, 'fake-docker-ok.sh')
  writeFileSync(
    fakeDockerOk,
    [
      '#!/bin/sh',
      'echo "fake-docker called with $#args" 1>&2',
      'for a in "$@"; do echo "arg=$a" 1>&2; done',
      'echo "container output" 1>&1',
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(fakeDockerOk, 0o755)

  fakeDockerErr = join(tmpRoot, 'fake-docker-err.sh')
  writeFileSync(
    fakeDockerErr,
    [
      '#!/bin/sh',
      'echo "boom" 1>&2',
      'exit 7',
    ].join('\n') + '\n',
  )
  chmodSync(fakeDockerErr, 0o755)

  fakeDockerSlow = join(tmpRoot, 'fake-docker-slow.sh')
  writeFileSync(
    fakeDockerSlow,
    [
      '#!/bin/sh',
      'sleep 5',
      'exit 0',
    ].join('\n') + '\n',
  )
  chmodSync(fakeDockerSlow, 0o755)
})

afterAll(() => {
  rmSync(tmpRoot, { recursive: true, force: true })
})

describe('DockerRunner — real subprocess (fake docker)', () => {
  it('returns a RunResult and writes evidence files on success', async () => {
    const config = makeConfig(tmpRoot)
    const task = makeTask('task-success')
    const runner = new DockerRunner({
      dockerBin: fakeDockerOk,
      image: 'fake:latest',
      command: ['echo', 'hi'],
    })
    const result = await runner.run(task, config)

    expect(result.taskId).toBe('task-success')
    expect(result.exitCode).toBe(0)
    expect(result.runId.length).toBeGreaterThan(0)
    expect(result.evidenceDir).toBe(join(config.outputBaseDir, 'task-success'))

    const stdoutLog = readFileSync(join(result.evidenceDir, 'stdout.log'), 'utf-8')
    const stderrLog = readFileSync(join(result.evidenceDir, 'stderr.log'), 'utf-8')
    const meta = JSON.parse(readFileSync(join(result.evidenceDir, 'docker-meta.json'), 'utf-8')) as Record<string, unknown>

    expect(stdoutLog).toContain('container output')
    expect(stderrLog).toContain('fake-docker called')
    expect(meta['image']).toBe('fake:latest')
    expect(meta['exitCode']).toBe(0)
    expect(meta['timedOut']).toBe(false)
    expect(Array.isArray(meta['args'])).toBe(true)
  })

  it('builds the expected docker argv (mounts + env)', async () => {
    const config = makeConfig(tmpRoot)
    const task = makeTask('task-argv')
    const runner = new DockerRunner({
      dockerBin: fakeDockerOk,
      image: 'argv-test:1',
      command: ['true'],
      env: { CUSTOM: 'yes' },
    })
    await runner.run(task, config)

    const meta = JSON.parse(
      readFileSync(join(config.outputBaseDir, 'task-argv', 'docker-meta.json'), 'utf-8'),
    ) as Record<string, unknown>
    const args = meta['args'] as string[]

    expect(args[0]).toBe('run')
    expect(args).toContain('--rm')
    expect(args).toContain('-v')
    expect(args.some((a) => a.includes('/aedev-workdir:rw'))).toBe(true)
    expect(args.some((a) => a.includes('/aedev-output:rw'))).toBe(true)
    expect(args).toContain('-w')
    expect(args).toContain('/aedev-workdir')
    expect(args).toContain('-e')
    expect(args.some((a) => a === 'TASK_ID=task-argv')).toBe(true)
    expect(args.some((a) => a === 'CUSTOM=yes')).toBe(true)
    expect(args).toContain('argv-test:1')
  })

  it('returns the container exit code on failure and records meta', async () => {
    const config = makeConfig(tmpRoot)
    const task = makeTask('task-fail')
    const runner = new DockerRunner({ dockerBin: fakeDockerErr, image: 'x', command: ['true'] })
    const result = await runner.run(task, config)

    expect(result.exitCode).toBe(7)
    const stderrLog = readFileSync(join(result.evidenceDir, 'stderr.log'), 'utf-8')
    expect(stderrLog).toContain('boom')
  })

  it('enforces the timeout and returns exitCode 124', async () => {
    const config = makeConfig(tmpRoot)
    const task = makeTask('task-slow')
    const runner = new DockerRunner({
      dockerBin: fakeDockerSlow,
      image: 'x',
      command: ['sleep', '5'],
      timeoutMs: 150,
    })
    const result = await runner.run(task, config)

    expect(result.exitCode).toBe(124)
    const meta = JSON.parse(
      readFileSync(join(result.evidenceDir, 'docker-meta.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(meta['timedOut']).toBe(true)
  })

  it('records a spawn error when the docker binary is missing', async () => {
    const config = makeConfig(tmpRoot)
    const task = makeTask('task-nodocker')
    const runner = new DockerRunner({ dockerBin: '/definitely/not/docker' })
    const result = await runner.run(task, config)

    expect(result.exitCode).toBe(-1)
    const meta = JSON.parse(
      readFileSync(join(result.evidenceDir, 'docker-meta.json'), 'utf-8'),
    ) as Record<string, unknown>
    expect(typeof meta['spawnError']).toBe('string')
  })

  it('isDockerAvailable returns false when the binary is missing', async () => {
    const runner = new DockerRunner({ dockerBin: '/no/such/docker' })
    expect(await runner.isDockerAvailable()).toBe(false)
  })
})

// allow-skip: env-gated smoke runner — only fires under AEDEV_SMOKE_DOCKER=1
const smokeRunner = process.env['AEDEV_SMOKE_DOCKER'] === '1' ? describe : describe.skip

smokeRunner('DockerRunner — smoke against real Docker (opt-in)', () => {
  it('runs an alpine container end-to-end and writes evidence', async () => {
    const config = makeConfig(tmpRoot)
    const task = makeTask('smoke-task')
    const runner = new DockerRunner({
      image: 'alpine:3.20',
      // Default command writes /aedev-output/done.txt.
    })
    expect(await runner.isDockerAvailable()).toBe(true)

    const result = await runner.run(task, config)
    expect(result.exitCode).toBe(0)
    expect(existsSync(join(result.evidenceDir, 'done.txt'))).toBe(true)
  }, 120_000)
})
