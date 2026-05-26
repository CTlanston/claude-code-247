import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb, type Mission, type RunResult, type Task } from '@aedev/core'
import { IntakeService } from './intake.js'
import { MissionRunner } from './mission-runner.js'
import type { RolePipeline } from './roles/role-pipeline.js'

let db: AedevDb
let stateDir: string
let intake: IntakeService
let repoId: string

beforeEach(() => {
  db = new AedevDb(':memory:')
  stateDir = join(tmpdir(), `aedev-mission-runner-test-${Date.now()}-${Math.random().toString(16).slice(2)}`)
  mkdirSync(stateDir, { recursive: true })
  repoId = db.insertRepo({
    name: 'sandbox',
    path: stateDir,
    defaultBranch: 'main',
    enabled: true,
    testCommands: [],
    forbiddenPaths: [],
    riskRules: {},
    mergePolicy: 'low-risk',
  }).id
  intake = new IntakeService(db, stateDir)
})

afterEach(() => {
  db.close()
  rmSync(stateDir, { recursive: true, force: true })
})

function approveMission() {
  const mission = intake.createMissionCandidate(repoId, 'Add a verified product increment')
  intake.requestApproval(mission.id)
  return intake.approveMission(mission.id, 'operator')
}

function fakeRolePipeline(): RolePipeline {
  return {
    async run(_mission: Mission, evidenceDir: string) {
      writeFileSync(join(evidenceDir, 'plan.md'), '# Plan\n\nImplement the requested increment.\n')
      return { outputs: [], evidenceDir }
    },
  } as unknown as RolePipeline
}

describe('MissionRunner', () => {
  it('runs an approved mission, writes evidence, and stores done status', async () => {
    const mission = approveMission()
    const taskEvidenceDir = join(stateDir, 'task-evidence')
    mkdirSync(taskEvidenceDir, { recursive: true })
    writeFileSync(join(taskEvidenceDir, 'diff-summary.md'), '# Diff Summary\n\nChanged app code.\n')
    writeFileSync(join(taskEvidenceDir, 'test-summary.md'), '# Test Summary\n\nTests passed.\n')
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: {
        async runTask(task: Task): Promise<RunResult> {
          return {
            runId: 'run-1',
            taskId: task.id,
            exitCode: 0,
            evidenceDir: taskEvidenceDir,
            durationMs: 25,
          }
        },
      },
    })

    const result = await runner.runMission(mission.id)

    expect(result.status).toBe('done')
    expect(db.getMission(mission.id)?.status).toBe('done')
    expect(existsSync(join(result.evidenceDir, 'prd.md'))).toBe(true)
    expect(readFileSync(join(result.evidenceDir, 'diff-summary.md'), 'utf-8')).toContain('Changed app code')
    expect(readFileSync(join(result.evidenceDir, 'test-summary.md'), 'utf-8')).toContain('Tests passed')
    expect(existsSync(join(result.evidenceDir, 'done-report.md'))).toBe(true)
  })

  it('marks the mission failed and records the error when the worker throws', async () => {
    const mission = approveMission()
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: {
        async runTask(): Promise<RunResult> {
          throw new Error('worker failed')
        },
      },
    })

    await expect(runner.runMission(mission.id)).rejects.toThrow(/worker failed/)
    expect(db.getMission(mission.id)?.status).toBe('failed')
    const errorPath = join(stateDir, 'evidence', mission.id, 'run-error.txt')
    expect(readFileSync(errorPath, 'utf-8')).toContain('worker failed')
  })

  it('refuses to run a non-approved mission', async () => {
    const mission = intake.createMissionCandidate(repoId, 'Do not run yet')
    const runner = new MissionRunner(db, { stateDir, rolePipeline: fakeRolePipeline() })

    await expect(runner.runMission(mission.id)).rejects.toThrow(/must be approved/)
    expect(db.getMission(mission.id)?.status).toBe('draft')
  })
})
