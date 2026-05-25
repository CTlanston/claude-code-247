import { describe, it, expect } from 'vitest'
import { writeFileSync, unlinkSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { loadReposYaml, validateRepoConfig } from './repo-registry.js'

describe('validateRepoConfig', () => {
  it('validates a minimal config', () => {
    const c = validateRepoConfig({ name: 'app', path: '/tmp/app' })
    expect(c.defaultBranch).toBe('main')
    expect(c.enabled).toBe(true)
    expect(c.forbiddenPaths).toContain('.env*')
  })

  it('throws for missing path', () => {
    expect(() => validateRepoConfig({ name: 'app' })).toThrow()
  })
})

describe('loadReposYaml', () => {
  it('parses a valid repos.yaml', () => {
    const p = join(tmpdir(), `repos-test-${Date.now()}.yaml`)
    writeFileSync(p, '- name: app\n  path: /tmp/app\n')
    try {
      const repos = loadReposYaml(p)
      expect(repos).toHaveLength(1)
      expect(repos[0]!.name).toBe('app')
    } finally { unlinkSync(p) }
  })

  it('throws if repos.yaml is not an array', () => {
    const p = join(tmpdir(), `repos-test-${Date.now()}.yaml`)
    writeFileSync(p, 'name: app\n')
    try {
      expect(() => loadReposYaml(p)).toThrow('must contain a YAML array')
    } finally { unlinkSync(p) }
  })
})
