import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Mission } from '@aedev/core'
import { ReleasePipeline, type DeployFn, type GitClient } from './release-pipeline.js'

let incidentsDir: string

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-rp-001',
    repoId: 'repo-1',
    title: 'Test release',
    description: 'Test',
    status: 'approved',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

function fakeGit(): GitClient & { reverted: string[] } {
  const reverted: string[] = []
  return {
    reverted,
    async resolveSha(ref) { return `sha-of-${ref}` },
    async revertMerge(sha) {
      reverted.push(sha)
      return `revert-of-${sha}`
    },
  }
}

function fakeDeploy(result: Partial<{ url: string | null; error: string; requiresSecretGrant: boolean; requiredSecretName: string }>): DeployFn {
  return async () => ({
    url: result.url ?? null,
    meta: {},
    error: result.error,
    requiresSecretGrant: result.requiresSecretGrant ?? false,
    requiredSecretName: result.requiredSecretName,
  })
}

function fakeFetch(statuses: number[]): typeof fetch {
  let i = 0
  return (async () => {
    const s = statuses[Math.min(i, statuses.length - 1)] ?? 500
    i++
    return new Response('', { status: s })
  }) as typeof fetch
}

beforeEach(() => {
  incidentsDir = mkdtempSync(join(tmpdir(), 'aedev-incidents-test-'))
})

afterEach(() => {
  rmSync(incidentsDir, { recursive: true, force: true })
})

describe('ReleasePipeline — no-op cases', () => {
  it('returns a no-op result when the merge decision is not AUTO_MERGE', async () => {
    const git = fakeGit()
    const pipeline = new ReleasePipeline(git, fakeDeploy({ url: 'https://prod' }), { incidentsDir })
    const result = await pipeline.release({
      mission: makeMission(),
      decision: 'WAITING',
      mergeSha: 'abc',
      productionDeployEnabled: true,
      outputDir: '/tmp/build',
    })
    expect(result.reverted).toBe(false)
    expect(git.reverted).toEqual([])
    expect(result.notes[0]).toMatch(/no-op/)
  })

  it('returns without deploying when productionDeployEnabled is false', async () => {
    const git = fakeGit()
    const pipeline = new ReleasePipeline(git, fakeDeploy({ url: 'https://prod' }), { incidentsDir })
    const result = await pipeline.release({
      mission: makeMission(),
      decision: 'AUTO_MERGE',
      mergeSha: 'abc',
      productionDeployEnabled: false,
    })
    expect(result.deployUrl).toBeNull()
    expect(result.reverted).toBe(false)
    expect(result.notes[0]).toMatch(/disabled/i)
  })
})

describe('ReleasePipeline — happy path', () => {
  it('deploys, polls healthcheck, and returns healthcheckPassed: true', async () => {
    const git = fakeGit()
    const pipeline = new ReleasePipeline(git, fakeDeploy({ url: 'https://prod.example' }), { incidentsDir })
    const result = await pipeline.release(
      {
        mission: makeMission(),
        decision: 'AUTO_MERGE',
        mergeSha: 'abc',
        productionDeployEnabled: true,
        outputDir: '/tmp/build',
        healthcheckUrl: 'https://prod.example/health',
      },
      {
        fetchFn: fakeFetch([200, 200, 200]),
        sleepFn: async () => {},
        intervalMs: 10,
        totalTimeoutMs: 1000,
        consecutiveSuccessesRequired: 2,
      },
    )
    expect(result.deployUrl).toBe('https://prod.example')
    expect(result.healthcheckPassed).toBe(true)
    expect(result.reverted).toBe(false)
    expect(git.reverted).toEqual([])
  })

  it('skips healthcheck when no URL is configured but still records success', async () => {
    const git = fakeGit()
    const pipeline = new ReleasePipeline(git, fakeDeploy({ url: 'https://prod' }), { incidentsDir })
    const result = await pipeline.release({
      mission: makeMission(),
      decision: 'AUTO_MERGE',
      mergeSha: 'abc',
      productionDeployEnabled: true,
      outputDir: '/tmp/build',
    })
    expect(result.deployUrl).toBe('https://prod')
    expect(result.healthcheckPassed).toBe(false)
    expect(result.reverted).toBe(false)
    expect(result.notes.some((n) => n.includes('no healthcheck'))).toBe(true)
  })
})

describe('ReleasePipeline — failure paths', () => {
  it('reverts the merge + records incident when deploy errors', async () => {
    const git = fakeGit()
    const pipeline = new ReleasePipeline(git, fakeDeploy({ error: 'deploy boom' }), { incidentsDir })
    const result = await pipeline.release({
      mission: makeMission({ id: 'mission-deploy-fail' }),
      decision: 'AUTO_MERGE',
      mergeSha: 'merge-abc',
      productionDeployEnabled: true,
      outputDir: '/tmp/build',
    })
    expect(result.reverted).toBe(true)
    expect(result.revertSha).toBe('revert-of-merge-abc')
    expect(git.reverted).toEqual(['merge-abc'])
    expect(result.incidentPath).toBeDefined()
    expect(existsSync(result.incidentPath!)).toBe(true)
    const md = readFileSync(result.incidentPath!, 'utf-8')
    expect(md).toContain('deploy boom')
    expect(md).toContain('merge-abc')
  })

  it('reverts the merge when healthcheck never reaches healthy state', async () => {
    const git = fakeGit()
    const pipeline = new ReleasePipeline(git, fakeDeploy({ url: 'https://prod' }), { incidentsDir })
    const result = await pipeline.release(
      {
        mission: makeMission(),
        decision: 'AUTO_MERGE',
        mergeSha: 'merge-bad',
        productionDeployEnabled: true,
        outputDir: '/tmp/build',
        healthcheckUrl: 'https://prod/health',
      },
      {
        fetchFn: fakeFetch([500, 500, 500]),
        sleepFn: async () => {},
        intervalMs: 1,
        totalTimeoutMs: 30,  // fail quickly
        consecutiveSuccessesRequired: 2,
      },
    )
    expect(result.healthcheckPassed).toBe(false)
    expect(result.reverted).toBe(true)
    expect(git.reverted).toEqual(['merge-bad'])
    expect(result.incidentPath).toBeDefined()
    const md = readFileSync(result.incidentPath!, 'utf-8')
    expect(md).toContain('Healthcheck failed')
  })

  it('pauses (no revert) when deploy reports requiresSecretGrant', async () => {
    const git = fakeGit()
    const pipeline = new ReleasePipeline(
      git,
      fakeDeploy({ requiresSecretGrant: true, requiredSecretName: 'CF_TOKEN' }),
      { incidentsDir },
    )
    const result = await pipeline.release({
      mission: makeMission(),
      decision: 'AUTO_MERGE',
      mergeSha: 'merge-need-grant',
      productionDeployEnabled: true,
      outputDir: '/tmp/build',
    })
    expect(result.deployRequiresSecretGrant).toBe(true)
    expect(result.deployRequiredSecretName).toBe('CF_TOKEN')
    expect(result.reverted).toBe(false)
    expect(git.reverted).toEqual([])
  })
})

describe('ReleasePipeline — healthcheck behaviour', () => {
  it('requires N consecutive successes before declaring healthy', async () => {
    const git = fakeGit()
    const pipeline = new ReleasePipeline(git, fakeDeploy({ url: 'https://prod' }), { incidentsDir })
    const result = await pipeline.release(
      {
        mission: makeMission(),
        decision: 'AUTO_MERGE',
        mergeSha: 'abc',
        productionDeployEnabled: true,
        outputDir: '/tmp/build',
        healthcheckUrl: 'https://prod/health',
      },
      {
        // Flaky pattern: 200, 500, 200, 200 (third + fourth are the consecutive pair)
        fetchFn: fakeFetch([200, 500, 200, 200, 200]),
        sleepFn: async () => {},
        intervalMs: 1,
        totalTimeoutMs: 5000,
        consecutiveSuccessesRequired: 2,
      },
    )
    expect(result.healthcheckPassed).toBe(true)
  })
})
