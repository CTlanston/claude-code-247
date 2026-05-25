import { describe, it, expect } from 'vitest'
import type { RunnerMode, RunnerConfig } from './index.js'

describe('runner', () => {
  it('RunnerMode includes docker, local, and mock', () => {
    const modes: RunnerMode[] = ['docker', 'local', 'mock']
    expect(modes).toHaveLength(3)
  })

  it('RunnerConfig has required fields', () => {
    const config: RunnerConfig = {
      mode: 'mock',
      maxConcurrentWorkers: 2,
      worktreeBaseDir: '/tmp/aedev/worktrees',
      outputBaseDir: '/tmp/aedev/output',
    }
    expect(config.mode).toBe('mock')
    expect(config.maxConcurrentWorkers).toBe(2)
  })
})
