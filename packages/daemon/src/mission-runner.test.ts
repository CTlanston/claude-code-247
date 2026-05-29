import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { AedevDb, type Mission, type RunResult, type Task, type ValidatorResult } from '@aedev/core'
import { IntakeService } from './intake.js'
import { MemoryGitClient, MissionRunner, type MissionValidator } from './mission-runner.js'
import { ReleasePipeline, type DeployFn } from './release-pipeline.js'
import type { RolePipeline } from './roles/role-pipeline.js'
import type { WorkerSession } from '@aedev/runner'

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

function approveMission(description = 'Add a verified product increment') {
  const mission = intake.createMissionCandidate(repoId, description)
  intake.requestApproval(mission.id)
  return intake.approveMission(mission.id, 'operator')
}

function fakeRolePipeline(): RolePipeline {
  return {
    async run(_mission: Mission, evidenceDir: string) {
      writeFileSync(join(evidenceDir, 'plan.md'), '# Plan\n\nImplement the requested increment.\n')
      writeFileSync(join(evidenceDir, 'tasks.json'), JSON.stringify({ specs: [{ ref: 'core', title: 't', prompt: 'p' }] }))
      return { outputs: [], evidenceDir }
    },
  } as unknown as RolePipeline
}

function fakeRunner(opts: { taskEvidenceDir: string; exitCode?: number; throwError?: string }) {
  return {
    async runTask(task: Task): Promise<RunResult> {
      if (opts.throwError) throw new Error(opts.throwError)
      return {
        runId: `run-${task.id}`,
        taskId: task.id,
        exitCode: opts.exitCode ?? 0,
        evidenceDir: opts.taskEvidenceDir,
        durationMs: 25,
      }
    },
  }
}

function workerSessions(): WorkerSession[] {
  return [
    { id: 'claude-1', provider: 'claude-cli', family: 'anthropic', healthy: true, active: 1 },
    { id: 'codex-1', provider: 'codex-cli', family: 'openai', healthy: true, active: 0 },
    { id: 'gemini-1', provider: 'gemini-api', family: 'google', healthy: true, active: 0 },
  ]
}

function fakeValidator(name: 'gemini' | 'openai' | 'mock', verdict: 'pass' | 'fail' | 'inconclusive'): MissionValidator {
  return {
    async validate(taskId: string): Promise<ValidatorResult> {
      return {
        id: `${name}-${taskId}`, taskId, runId: `${name}-run`, validator: name,
        verdict, summary: `${name} stub: ${verdict}`, createdAt: new Date().toISOString(),
      }
    },
  }
}

function makeTaskEvidence(diffSummary = '# Diff Summary\n\nChanged app code.\n'): string {
  const dir = join(stateDir, 'task-evidence')
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'diff-summary.md'), diffSummary)
  writeFileSync(join(dir, 'test-summary.md'), '# Test Summary\n\nTests passed.\n')
  writeFileSync(join(dir, 'done-report.md'), '# Done\n\nDone.\n')
  return dir
}

describe('MissionRunner — workbook end-to-end glue', () => {
  it('AUTO_MERGE when dual validators pass + low risk (non-UI mission)', async () => {
    const mission = approveMission('Refactor the auth utility (no UI)')
    const taskEvidenceDir = makeTaskEvidence()
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir }),
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'pass')],
      requiresUi: false,
    })

    const result = await runner.runMission(mission.id)
    expect(result.mergeDecision).toBe('AUTO_MERGE')
    expect(result.status).toBe('done')
    expect(result.validatorResults).toHaveLength(2)
    expect(result.riskLevel).toBe('low')
    expect(db.getMission(mission.id)?.status).toBe('done')
    const summary = readFileSync(join(result.evidenceDir, 'workbook-summary.md'), 'utf-8')
    expect(summary).toContain('AUTO_MERGE')
    expect(summary).toContain('gemini: pass')
    expect(summary).toContain('openai: pass')
  })

  it('persists model_usage from the runner model-usage.json + emits model.usage.recorded', async () => {
    const mission = approveMission('Refactor the auth utility (no UI)')
    const taskEvidenceDir = join(stateDir, 'coder-evidence')
    mkdirSync(taskEvidenceDir, { recursive: true })
    writeFileSync(join(taskEvidenceDir, 'diff-summary.md'), '# Diff Summary\n\nChanged app code.\n')
    writeFileSync(join(taskEvidenceDir, 'model-usage.json'), JSON.stringify({
      provider: 'claude-cli', inputTokens: 1500, outputTokens: 420, costUsd: 0.09, durationMs: 1234,
    }))
    const costSamples: Array<{ ts: string; costUsd: number; bucket?: string }> = []
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir }),
      requiresUi: false,
      costRoller: { record: (s) => costSamples.push(s) },
    })

    const result = await runner.runMission(mission.id)

    const usage = db.listModelUsage(result.taskId)
    expect(usage).toHaveLength(1)
    expect(usage[0]?.inputTokens).toBe(1500)
    expect(usage[0]?.outputTokens).toBe(420)
    expect(usage[0]?.costUsd).toBe(0.09)
    expect(usage[0]?.provider).toBe('claude-cli')

    const events = db.queryEvents({ type: 'model.usage.recorded' })
    expect(events).toHaveLength(1)
    expect(events[0]?.payload['inputTokens']).toBe(1500)
    expect(events[0]?.payload['outputTokens']).toBe(420)

    expect(costSamples).toHaveLength(1)
    expect(costSamples[0]?.costUsd).toBe(0.09)
    expect(costSamples[0]?.bucket).toBe(mission.id)
  })

  it('does not persist model_usage when the runner wrote no usage file', async () => {
    const mission = approveMission('Refactor the auth utility (no UI)')
    const taskEvidenceDir = makeTaskEvidence()
    const runner = new MissionRunner(db, {
      stateDir, rolePipeline: fakeRolePipeline(), runner: fakeRunner({ taskEvidenceDir }), requiresUi: false,
    })
    const result = await runner.runMission(mission.id)
    expect(db.listModelUsage(result.taskId)).toHaveLength(0)
    expect(db.queryEvents({ type: 'model.usage.recorded' })).toHaveLength(0)
  })

  it('passes worker test evidence to validators instead of QA pending stubs', async () => {
    const mission = approveMission('Refactor backend evidence merge')
    const taskEvidenceDir = makeTaskEvidence('# Diff Summary\n\nDocs only.\n')
    const validatingFake = (name: 'gemini' | 'openai'): MissionValidator => ({
      async validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult> {
        expect(bundle['test-summary.md']).toContain('Tests passed.')
        expect(bundle['test-summary.md']).not.toContain('Status:** Pending')
        return {
          id: `${name}-${taskId}`, taskId, runId: `${name}-run`, validator: name,
          verdict: 'pass', summary: `${name} saw worker test evidence`, createdAt: new Date().toISOString(),
        }
      },
    })
    const runner = new MissionRunner(db, {
      stateDir,
      // Use the real RolePipeline so QA writes its pending test-summary stub first.
      runner: fakeRunner({ taskEvidenceDir }),
      validators: [validatingFake('gemini'), validatingFake('openai')],
      requiresUi: false,
    })

    const result = await runner.runMission(mission.id)

    expect(result.mergeDecision).toBe('AUTO_MERGE')
    expect(readFileSync(join(result.evidenceDir, 'test-summary.md'), 'utf-8')).toContain('Tests passed.')
  })

  it('WAITING when no validators are configured (safety default)', async () => {
    const mission = approveMission()
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      // no validators
    })
    const result = await runner.runMission(mission.id)
    expect(result.mergeDecision).toBe('WAITING')
    expect(result.status).toBe('waiting')
    expect(db.getMission(mission.id)?.status).toBe('paused')
  })

  it('BLOCKED when any validator returns fail', async () => {
    const mission = approveMission()
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'fail')],
      requiresUi: false,
    })
    const result = await runner.runMission(mission.id)
    expect(result.mergeDecision).toBe('BLOCKED')
    expect(result.status).toBe('blocked')
  })

  it('routes dual-validator hard-gate coder work to Claude', async () => {
    const mission = approveMission('Implement a low-risk dual-validator change')
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      workerSessions: workerSessions(),
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'pass')],
      requiresUi: false,
    })

    const result = await runner.runMission(mission.id)

    expect(result.routeDecision?.provider).toBe('claude-cli')
    expect(result.mergeDecision).toBe('AUTO_MERGE')
  })

  it('does not treat OpenAI validator as independent when Codex authored the work', async () => {
    const mission = approveMission('Implement a low-risk Codex-authored change')
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      runnerConfig: {
        mode: 'codex-cli',
        maxConcurrentWorkers: 1,
        worktreeBaseDir: join(stateDir, 'worktrees'),
        outputBaseDir: join(stateDir, 'tasks'),
      },
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'pass')],
      requiresUi: false,
    })

    const result = await runner.runMission(mission.id)

    expect(result.routeDecision?.provider).toBe('codex-cli')
    expect(result.mergeDecision).toBe('WAITING')
    expect(result.status).toBe('waiting')
  })

  it('UI mission runs BrowserQA and reaches AUTO_MERGE when screenshots pass', async () => {
    const mission = approveMission('Build a polished landing page UI')
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'pass')],
      // requiresUi defaults to heuristic (mission title contains "landing page UI")
    })
    const result = await runner.runMission(mission.id)
    expect(result.browserQAResult).toBeDefined()
    expect(result.browserQAResult?.screenshots.length).toBeGreaterThan(0)
    expect(result.mergeDecision).toBe('AUTO_MERGE')
    expect(existsSync(join(result.evidenceDir, 'screenshot-desktop.png'))).toBe(true)
    expect(existsSync(join(result.evidenceDir, 'screenshot-report.md'))).toBe(true)
  })

  it('ReleasePipeline runs on AUTO_MERGE when productionDeployEnabled', async () => {
    const mission = approveMission('Refactor backend (no UI)')
    const git = new MemoryGitClient()
    const deployFn: DeployFn = async () => ({ url: 'https://prod.example/deploy', meta: {} })
    const releasePipeline = new ReleasePipeline(git, deployFn, { incidentsDir: join(stateDir, 'incidents') })
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'pass')],
      releasePipeline,
      productionDeployEnabled: true,
      requiresUi: false,
    })
    const result = await runner.runMission(mission.id)
    expect(result.mergeDecision).toBe('AUTO_MERGE')
    expect(result.releaseResult).toBeDefined()
    expect(result.releaseResult?.deployUrl).toBe('https://prod.example/deploy')
    expect(git.reverts).toHaveLength(0)
  })

  it('ReleasePipeline reverts when healthcheck fails', async () => {
    const mission = approveMission('Backend release with healthcheck')
    const git = new MemoryGitClient()
    const deployFn: DeployFn = async () => ({ url: 'https://prod.example', meta: {} })
    const releasePipeline = new ReleasePipeline(git, deployFn, { incidentsDir: join(stateDir, 'incidents') })
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'pass')],
      releasePipeline,
      productionDeployEnabled: true,
      healthcheckUrl: 'https://prod.example/health',
      requiresUi: false,
    })
    // Inject the failing healthcheck via a custom release pipeline result is hard;
    // instead reuse the pattern by configuring a tiny window + always-failing fetch.
    // Since MissionRunner takes the pipeline already constructed, we approximate
    // by stubbing the pipeline's `release` method.
    const originalRelease = releasePipeline.release.bind(releasePipeline)
    releasePipeline.release = async (req) => {
      const r = await originalRelease(req, {
        fetchFn: (async () => new Response('', { status: 500 })) as typeof fetch,
        sleepFn: async () => {},
        intervalMs: 1,
        totalTimeoutMs: 10,
        consecutiveSuccessesRequired: 2,
      })
      return r
    }
    const result = await runner.runMission(mission.id)
    expect(result.releaseResult?.reverted).toBe(true)
    expect(git.reverts).toHaveLength(1)
    expect(existsSync(result.releaseResult!.incidentPath!)).toBe(true)
  })

  it('Worker throw → status failed + run-error.txt recorded (unchanged path)', async () => {
    const mission = approveMission()
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence(), throwError: 'worker failed' }),
    })
    await expect(runner.runMission(mission.id)).rejects.toThrow(/worker failed/)
    expect(db.getMission(mission.id)?.status).toBe('failed')
    const errorPath = join(stateDir, 'evidence', mission.id, 'run-error.txt')
    expect(readFileSync(errorPath, 'utf-8')).toContain('worker failed')
  })

  it('refuses to run a non-approved mission (unchanged)', async () => {
    const mission = intake.createMissionCandidate(repoId, 'Do not run yet')
    const runner = new MissionRunner(db, { stateDir, rolePipeline: fakeRolePipeline() })
    await expect(runner.runMission(mission.id)).rejects.toThrow(/must be approved/)
    expect(db.getMission(mission.id)?.status).toBe('draft')
  })

  it('writes a workbook-summary.md with every gate that ran', async () => {
    const mission = approveMission()
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'pass')],
      requiresUi: false,
    })
    const result = await runner.runMission(mission.id)
    const summary = readFileSync(join(result.evidenceDir, 'workbook-summary.md'), 'utf-8')
    expect(summary).toContain('Mission:')
    expect(summary).toContain('Risk:')
    expect(summary).toContain('Validators')
    expect(summary).toMatch(/Decision:[*\s]*AUTO_MERGE/)
  })

  it('routes dual-validator coder work through WorkerPoolRouter and records the Claude route decision', async () => {
    const mission = approveMission('Implement the routing glue')
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      workerSessions: workerSessions(),
      validators: [fakeValidator('gemini', 'pass'), fakeValidator('openai', 'pass')],
    })

    const result = await runner.runMission(mission.id)

    expect(result.routeDecision?.provider).toBe('claude-cli')
    expect(readFileSync(join(result.evidenceDir, 'worker-route.json'), 'utf8')).toContain('"provider": "claude-cli"')
  })

  it('holds the mission when the worker router has no healthy coder session', async () => {
    const mission = approveMission('Implement a safe hold path')
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      workerSessions: [{ id: 'codex-1', provider: 'codex-cli', family: 'openai', healthy: false, active: 0 }],
    })

    const result = await runner.runMission(mission.id)

    expect(result.status).toBe('waiting')
    expect(result.mergeDecision).toBe('WAITING')
    expect(db.getMission(mission.id)?.status).toBe('paused')
    expect(readFileSync(join(result.evidenceDir, 'run-hold.json'), 'utf8')).toContain('HOLD-SESSION-POOL')
  })

  it('holds when validator family separation cannot be satisfied', async () => {
    const mission = approveMission('Validate the routed family guard')
    const runner = new MissionRunner(db, {
      stateDir,
      rolePipeline: fakeRolePipeline(),
      runner: fakeRunner({ taskEvidenceDir: makeTaskEvidence() }),
      workerSessions: [
        { id: 'codex-1', provider: 'codex-cli', family: 'openai', healthy: true, active: 0 },
      ],
      validators: [fakeValidator('openai', 'pass')],
    })

    const result = await runner.runMission(mission.id)

    expect(result.status).toBe('waiting')
    expect(result.validatorRouteDecision?.holdCode).toBe('HOLD-FAMILY-CONFLICT')
    expect(db.getMission(mission.id)?.status).toBe('paused')
  })
})
