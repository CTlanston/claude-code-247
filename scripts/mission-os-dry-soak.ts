import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb, type Mission, type RunResult, type Task } from '@aedev/core'
import {
  AutonomousIntakeService,
  IntakeService,
  MissionIntakeSource,
  MissionRunner,
  type RolePipeline,
} from '@aedev/daemon'
import type { WorkerSession } from '@aedev/runner'

interface DrySoakReport {
  startedAt: string
  endedAt: string
  iterations: number
  executed: number
  held: number
  proposals: number
  failures: number
  reportPath: string
}

async function main(): Promise<void> {
  const iterations = readIntArg('--iterations', 3)
  const startedAt = new Date()
  const stateDir = mkdtempSync(join(tmpdir(), 'aedev-mission-os-dry-soak-'))
  const db = new AedevDb(':memory:')

  try {
    const repoPath = join(stateDir, 'repo')
    mkdirSync(repoPath, { recursive: true })
    writeFileSync(join(repoPath, 'src.ts'), [
      'export function routeMission(x: number) {',
      '  // TODO: refine worker router overflow handling',
      '  return x + 1',
      '}',
      '',
    ].join('\n'))

    const repo = db.insertRepo({
      name: 'mission-os-dry-soak',
      path: repoPath,
      defaultBranch: 'main',
      enabled: true,
      testCommands: ['pnpm test -- --reporter=json'],
      forbiddenPaths: ['.env', '.env.*', 'secrets/**', '.github/**'],
      riskRules: {},
      mergePolicy: 'low-risk',
    })

    let executed = 0
    let held = 0
    let proposals = 0
    let failures = 0

    for (let i = 0; i < iterations; i++) {
      const autoIntake = new AutonomousIntakeService(db, stateDir, {
        capPerRepo: 5,
        sourceFactory: async (_repo, options) => new MissionIntakeSource({
          ...options,
          manual: [{
            id: `manual-${i}`,
            source: 'manual',
            title: `Dry soak mission ${i + 1}`,
            body: 'Exercise the routed MissionRunner path with safe local evidence.',
            repoId: repo.id,
          }],
          failingTests: {
            repoPath,
            repoId: repo.id,
            runCommand: async () => ({
              exitCode: 1,
              stdout: JSON.stringify({
                testResults: [{
                  name: 'src/mission-runner.test.ts',
                  assertionResults: [{
                    status: 'failed',
                    title: 'should hold on exhausted validator families',
                    ancestorTitles: ['MissionRunner'],
                    failureMessages: ['expected WAITING hold when validator family conflicts'],
                  }],
                }],
              }),
              stderr: '',
            }),
          },
        }),
      })
      const intakeResult = await autoIntake.scan({ repoId: repo.id })
      proposals += intakeResult.missions.filter((candidate) => candidate.decision === 'proposal_only').length
      const executable = intakeResult.missions.find((candidate) => candidate.missionStatus === 'pending_approval')
      if (!executable?.missionId) {
        failures++
        continue
      }

      const intake = new IntakeService(db, stateDir)
      intake.approveMission(executable.missionId, 'dry-soak')

      const result = await new MissionRunner(db, {
        stateDir,
        rolePipeline: drySoakRolePipeline(),
        runner: drySoakRunner(stateDir),
        workerSessions: drySoakSessions(i),
        validators: i === 1 ? [] : [passValidator('gemini'), passValidator('openai')],
      }).runMission(executable.missionId)

      const isHeld = Boolean(result.routeDecision?.holdCode || result.validatorRouteDecision?.holdCode)
      if (isHeld) held++
      else if (result.status === 'done' || result.status === 'waiting') executed++
      if (result.status === 'failed') failures++
    }

    const reportDir = join(process.cwd(), 'evidence', 'stage-v23', 'dry-soak')
    mkdirSync(reportDir, { recursive: true })
    const reportPath = join(reportDir, 'mission-os-dry-soak.json')
    const report: DrySoakReport = {
      startedAt: startedAt.toISOString(),
      endedAt: new Date().toISOString(),
      iterations,
      executed,
      held,
      proposals,
      failures,
      reportPath,
    }
    writeFileSync(reportPath, JSON.stringify(report, null, 2))
    console.log(JSON.stringify(report, null, 2))

    if (executed === 0) throw new Error('Dry soak did not execute any mission successfully')
  } finally {
    db.close()
    rmSync(stateDir, { recursive: true, force: true })
  }
}

function readIntArg(flag: string, fallback: number): number {
  const idx = process.argv.indexOf(flag)
  if (idx < 0) return fallback
  const value = Number(process.argv[idx + 1] ?? String(fallback))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function drySoakRolePipeline(): RolePipeline {
  return {
    async run(mission: Mission, evidenceDir: string) {
      writeFileSync(join(evidenceDir, 'plan.md'), `# Plan\n\nRoute and execute ${mission.title}.\n`)
      writeFileSync(join(evidenceDir, 'tasks.json'), JSON.stringify({
        specs: [{ ref: 'dry-soak', title: mission.title, prompt: mission.description ?? mission.title }],
      }, null, 2))
      return { outputs: [], evidenceDir }
    },
  } as unknown as RolePipeline
}

function drySoakRunner(stateDir: string) {
  return {
    async runTask(task: Task): Promise<RunResult> {
      const evidenceDir = join(stateDir, 'task-evidence', task.id)
      mkdirSync(evidenceDir, { recursive: true })
      writeFileSync(join(evidenceDir, 'diff-summary.md'), '# Diff Summary\n\nSynthetic dry-soak change.\n')
      writeFileSync(join(evidenceDir, 'test-summary.md'), '# Test Summary\n\nSynthetic dry-soak pass.\n')
      writeFileSync(join(evidenceDir, 'done-report.md'), '# Done Report\n\nDry-soak mission completed.\n')
      return {
        runId: `dry-soak-run-${task.id}`,
        taskId: task.id,
        exitCode: 0,
        evidenceDir,
        durationMs: 25,
      }
    },
  }
}

function drySoakSessions(iteration: number): WorkerSession[] {
  if (iteration === 1) {
    return [
      { id: 'codex-only', provider: 'codex-cli', family: 'openai', healthy: true, active: 0, lastHeartbeatAt: '2026-05-28T00:00:00.000Z' },
    ]
  }
  return [
    { id: 'claude-1', provider: 'claude-cli', family: 'anthropic', healthy: true, active: 1, lastHeartbeatAt: '2026-05-28T00:00:00.000Z' },
    { id: 'codex-1', provider: 'codex-cli', family: 'openai', healthy: true, active: 0, lastHeartbeatAt: '2026-05-28T00:00:00.000Z' },
    { id: 'gemini-1', provider: 'gemini-api', family: 'google', healthy: true, active: 0, lastHeartbeatAt: '2026-05-28T00:00:00.000Z' },
  ]
}

function passValidator(name: 'gemini' | 'openai') {
  return {
    async validate(taskId: string) {
      return {
        id: `${name}-${taskId}`,
        taskId,
        runId: `${name}-run`,
        validator: name,
        verdict: 'pass' as const,
        summary: `${name} dry-soak pass`,
        createdAt: new Date().toISOString(),
      }
    },
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
