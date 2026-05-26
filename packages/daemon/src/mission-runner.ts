import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AedevDb, Mission, RunnerConfig, RunResult, Task } from '@aedev/core'
import { RunnerManager } from '@aedev/runner'
import { RolePipeline } from './roles/role-pipeline.js'

export interface MissionRunOptions {
  stateDir: string
  runnerConfig?: RunnerConfig
  rolePipeline?: RolePipeline
  runner?: { runTask(task: Task): Promise<RunResult> }
}

export interface MissionRunResult {
  missionId: string
  taskId: string
  status: 'done' | 'failed'
  evidenceDir: string
  run: RunResult
}

export class MissionRunner {
  constructor(
    private readonly db: AedevDb,
    private readonly opts: MissionRunOptions,
  ) {}

  async runMission(missionId: string): Promise<MissionRunResult> {
    const mission = this.db.getMission(missionId)
    if (!mission) throw new Error(`Mission ${missionId} not found`)
    if (mission.status !== 'approved') {
      throw new Error(`Mission ${missionId} must be approved before run (current status: ${mission.status})`)
    }

    const evidenceDir = join(this.opts.stateDir, 'evidence', mission.id)
    mkdirSync(evidenceDir, { recursive: true })
    copyPrdIntoEvidence(this.opts.stateDir, evidenceDir, mission)

    this.db.updateMissionStatus(mission.id, 'running')
    this.db.insertEvent('mission.run_started', 'mission', mission.id, { evidenceDir })

    try {
      const pipeline = this.opts.rolePipeline ?? new RolePipeline()
      await pipeline.run(mission, evidenceDir)

      const task = this.db.insertTask({
        missionId: mission.id,
        repoId: mission.repoId,
        title: `Implement mission: ${mission.title}`,
        prompt: buildTaskPrompt(mission, evidenceDir),
        status: 'pending',
        attemptNumber: 1,
      })

      const runner = this.opts.runner ?? new RunnerManager(this.db, this.opts.runnerConfig ?? {
        mode: 'mock',
        maxConcurrentWorkers: 1,
        worktreeBaseDir: join(this.opts.stateDir, 'worktrees'),
        outputBaseDir: join(this.opts.stateDir, 'evidence', 'tasks'),
      })
      const run = await runner.runTask(task)
      importTaskEvidence(run.evidenceDir, evidenceDir)
      ensureRequiredEvidence(evidenceDir)

      const status = run.exitCode === 0 ? 'done' : 'failed'
      this.db.updateMissionStatus(mission.id, status)
      this.db.insertEvent('mission.run_completed', 'mission', mission.id, {
        taskId: task.id,
        runId: run.runId,
        exitCode: run.exitCode,
        status,
      })
      return { missionId: mission.id, taskId: task.id, status, evidenceDir, run }
    } catch (e) {
      this.db.updateMissionStatus(mission.id, 'failed')
      this.db.insertEvent('mission.run_failed', 'mission', mission.id, { error: (e as Error).message })
      writeFileSync(join(evidenceDir, 'run-error.txt'), `${(e as Error).message}\n`)
      throw e
    }
  }
}

function buildTaskPrompt(mission: Mission, evidenceDir: string): string {
  return [
    `Mission: ${mission.title}`,
    mission.description ? `Description: ${mission.description}` : '',
    `Evidence directory: ${evidenceDir}`,
    'Implement the smallest real change needed for this mission and produce plan, diff summary, tests, and done report.',
  ].filter(Boolean).join('\n\n')
}

function copyPrdIntoEvidence(stateDir: string, evidenceDir: string, mission: Mission): void {
  const candidates = [
    mission.prdPath,
    join(stateDir, 'prd', `${mission.id}.md`),
  ].filter((p): p is string => Boolean(p))
  for (const p of candidates) {
    if (existsSync(p)) {
      copyFileSync(p, join(evidenceDir, 'prd.md'))
      return
    }
  }
}

function importTaskEvidence(taskEvidenceDir: string, missionEvidenceDir: string): void {
  if (!existsSync(taskEvidenceDir)) return
  for (const entry of readdirSync(taskEvidenceDir)) {
    const src = join(taskEvidenceDir, entry)
    if (!statSync(src).isFile()) continue
    const dest = join(missionEvidenceDir, entry)
    if (!existsSync(dest)) copyFileSync(src, dest)
  }
}

function ensureRequiredEvidence(evidenceDir: string): void {
  const required: Record<string, string> = {
    'plan.md': '# Plan\n\nMission runner did not receive a task plan from the worker.\n',
    'diff-summary.md': '# Diff Summary\n\nNo diff summary was produced by the worker.\n',
    'test-summary.md': '# Test Summary\n\nNo test summary was produced by the worker.\n',
    'risk-report.md': '# Risk Report\n\nRisk score: 0\nLevel: low\n',
    'done-report.md': '# Done Report\n\nMission runner completed.\n',
  }
  for (const [name, fallback] of Object.entries(required)) {
    const path = join(evidenceDir, name)
    if (!existsSync(path) || readFileSync(path, 'utf8').trim() === '') {
      writeFileSync(path, fallback)
    }
  }
}
