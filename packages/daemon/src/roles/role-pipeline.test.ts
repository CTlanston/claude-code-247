import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { rmSync, mkdtempSync, readFileSync, existsSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { Mission } from '@aedev/core'
import { RolePipeline } from './role-pipeline.js'
import type { BuilderTaskSpec } from './role-interface.js'

let evidenceDir: string

function makeMission(overrides: Partial<Mission> = {}): Mission {
  return {
    id: 'mission-test-001',
    repoId: 'repo-1',
    title: 'Add a polished landing page and dashboard',
    description: 'Build a marketing landing page and a dashboard UI for the fictional SaaS.',
    status: 'approved',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  }
}

beforeEach(() => {
  evidenceDir = mkdtempSync(join(tmpdir(), 'aedev-role-pipeline-test-'))
})

afterEach(() => {
  rmSync(evidenceDir, { recursive: true, force: true })
})

describe('RolePipeline — end-to-end role sequence', () => {
  it('runs all six default roles in canonical order and writes per-role evidence', async () => {
    const pipeline = new RolePipeline()
    const result = await pipeline.run(makeMission(), evidenceDir)

    expect(result.rolesRun).toEqual([
      'architect',
      'designer',
      'builder',
      'qa',
      'reviewer',
      'release',
    ])
    expect(result.missionId).toBe('mission-test-001')
    expect(result.evidenceDir).toBe(evidenceDir)

    // Architect artefacts
    expect(existsSync(join(evidenceDir, 'architecture.md'))).toBe(true)
    expect(existsSync(join(evidenceDir, 'roadmap.md'))).toBe(true)
    expect(existsSync(join(evidenceDir, 'risk-map.md'))).toBe(true)
    expect(existsSync(join(evidenceDir, 'adr-mission.md'))).toBe(true)

    // Designer artefacts (UI detected by heuristic)
    expect(existsSync(join(evidenceDir, 'design-brief.md'))).toBe(true)
    const brief = readFileSync(join(evidenceDir, 'design-brief.md'), 'utf-8')
    expect(brief).toContain('Visual Direction')

    // Builder artefacts
    expect(existsSync(join(evidenceDir, 'tasks.json'))).toBe(true)
    expect(existsSync(join(evidenceDir, 'task-list.md'))).toBe(true)

    // QA artefacts
    expect(existsSync(join(evidenceDir, 'test-summary.md'))).toBe(true)
    expect(existsSync(join(evidenceDir, 'screenshot-report.md'))).toBe(true)

    // Reviewer
    expect(existsSync(join(evidenceDir, 'reviewer-checklist.md'))).toBe(true)
    const checklist = readFileSync(join(evidenceDir, 'reviewer-checklist.md'), 'utf-8')
    expect(checklist).toContain('Evidence audit')

    // Release
    expect(existsSync(join(evidenceDir, 'release-checklist.md'))).toBe(true)

    // Manifest
    const manifest = JSON.parse(readFileSync(join(evidenceDir, 'pipeline-manifest.json'), 'utf-8')) as Record<string, unknown>
    expect(manifest['missionId']).toBe('mission-test-001')
    expect((manifest['rolesRun'] as string[]).length).toBe(6)
    expect(manifest['requiresUi']).toBe(true)
  })

  it('skips Designer UI brief when mission has no UI scope', async () => {
    const pipeline = new RolePipeline()
    const m = makeMission({ title: 'Fix a CLI bug', description: 'Resolve the off-by-one in start_cmd parsing' })
    const result = await pipeline.run(m, evidenceDir)

    const brief = readFileSync(join(evidenceDir, 'design-brief.md'), 'utf-8')
    expect(brief).toContain('no UI scope')
    expect(existsSync(join(evidenceDir, 'screenshot-report.md'))).toBe(false)
    expect(result.bundle['screenshot-report.md']).toBeUndefined()
  })

  it('Builder emits a task graph with non-overlapping fileOwnership for parallel tasks', async () => {
    const pipeline = new RolePipeline()
    await pipeline.run(makeMission(), evidenceDir)

    const tasks = JSON.parse(readFileSync(join(evidenceDir, 'tasks.json'), 'utf-8')) as { specs: BuilderTaskSpec[] }
    expect(tasks.specs.length).toBeGreaterThanOrEqual(4)

    // Every spec has either no dependencies or all deps reference a known ref
    const refs = new Set(tasks.specs.map((s) => s.ref))
    for (const s of tasks.specs) {
      for (const d of s.dependsOn ?? []) {
        expect(refs.has(d)).toBe(true)
      }
    }

    // For parallel tasks (same dependency depth), fileOwnership should not overlap exactly.
    // Heuristic: tests + docs are siblings — they should claim different paths.
    const tests = tasks.specs.find((s) => s.ref === 'tests')
    const docs = tasks.specs.find((s) => s.ref === 'docs')
    expect(tests?.fileOwnership).not.toEqual(docs?.fileOwnership)
  })

  it('absorbs a pre-existing PRD (e.g. from IntakeService) into the bundle as prd.md', async () => {
    // Simulate IntakeService writing the PRD as <missionId>.md
    const prdContent = `# PRD: Test mission\n\n## Summary\nA tiny test PRD that the Architect will consume.\n`
    writeFileSync(join(evidenceDir, 'mission-test-001.md'), prdContent)

    const pipeline = new RolePipeline()
    const result = await pipeline.run(makeMission(), evidenceDir)

    expect(result.bundle['prd.md']).toBeDefined()
    expect(result.bundle['prd.md']).toContain('A tiny test PRD')

    const arch = readFileSync(join(evidenceDir, 'architecture.md'), 'utf-8')
    // Architect surfaces the PRD summary into its plan
    expect(arch).toContain('A tiny test PRD')
  })

  it('honors explicit requiresUi=false override', async () => {
    const pipeline = new RolePipeline()
    const m = makeMission({ title: 'Add a polished landing page and dashboard' })
    await pipeline.run(m, evidenceDir, { requiresUi: false })

    const brief = readFileSync(join(evidenceDir, 'design-brief.md'), 'utf-8')
    expect(brief).toContain('no UI scope')
  })

  it('reviewer-checklist flags missing required evidence', async () => {
    // Run the pipeline but with a custom role list that omits the Builder
    // — Reviewer should then mark tasks.json as missing.
    const { ArchitectRole } = await import('./architect-role.js')
    const { ReviewerRole } = await import('./reviewer-role.js')
    const pipeline = new RolePipeline({ roles: [new ArchitectRole(), new ReviewerRole()] })
    await pipeline.run(makeMission(), evidenceDir)

    const checklist = readFileSync(join(evidenceDir, 'reviewer-checklist.md'), 'utf-8')
    expect(checklist).toContain('tasks.json: ⚠️ missing')
    expect(checklist).toContain('architecture.md: ✅ present')
  })
})
