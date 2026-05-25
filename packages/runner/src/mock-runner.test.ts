import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Task, RunnerConfig } from '@aedev/core'
import { MockRunner } from './mock-runner.js'
import { EvidenceWriter } from './evidence.js'

const mockTask: Task = {
  id: 'task-001', missionId: 'mission-001', repoId: 'repo-001',
  title: 'Test task', prompt: 'Do something', status: 'pending',
  attemptNumber: 0, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
}

let outputDir: string
beforeEach(() => { outputDir = join(tmpdir(), `runner-test-${Date.now()}`) })
afterEach(() => rmSync(outputDir, { recursive: true, force: true }))

describe('MockRunner', () => {
  it('produces a run result with exitCode 0', async () => {
    const config: RunnerConfig = { mode: 'mock', maxConcurrentWorkers: 1, worktreeBaseDir: outputDir, outputBaseDir: outputDir }
    const runner = new MockRunner()
    const result = await runner.run(mockTask, config)
    expect(result.exitCode).toBe(0)
    expect(result.taskId).toBe('task-001')
    expect(result.durationMs).toBeGreaterThan(0)
  })

  it('writes evidence bundle with expected files', async () => {
    const config: RunnerConfig = { mode: 'mock', maxConcurrentWorkers: 1, worktreeBaseDir: outputDir, outputBaseDir: outputDir }
    const runner = new MockRunner()
    const result = await runner.run(mockTask, config)
    const w = new EvidenceWriter(result.evidenceDir)
    const bundle = w.toBundle()
    expect(Object.keys(bundle)).toContain('plan.md')
    expect(Object.keys(bundle)).toContain('test-summary.md')
    expect(Object.keys(bundle)).toContain('done-report.md')
  })
})
