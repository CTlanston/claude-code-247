import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'fs'
import { join } from 'path'
import type {
  AedevDb, Mission, MissionDesign, RunnerConfig, RunResult, Task, ValidatorResult, MergePolicyDecision,
} from '@aedev/core'
import { RunnerManager, WorkerPoolRouter, type ModelFamily, type RouteDecision, type WorkerSession } from '@aedev/runner'
import {
  assertDifferentFamily,
  FamilyConflictError,
  MergePolicy,
  RiskScorer,
  type MergePolicyEvidence,
} from '@aedev/validators'
import { BrowserQA, MockBrowserDriver, type BrowserQAResult } from '@aedev/qa'
import type { PreviewAdapter, PreviewResult } from '@aedev/preview'
import { RolePipeline } from './roles/role-pipeline.js'
import { ReleasePipeline, type GitClient, type DeployFn, type DeployRequest, type ReleaseResult } from './release-pipeline.js'
import { BoundedMoveRunner, type BoundedMove } from './moves/index.js'

/**
 * Mission validator contract.  Production wires real Gemini + OpenAI; tests
 * inject a stub.  Both are intentionally typed wider than the SDK classes so
 * the e2e smoke can run without API keys.
 */
export interface MissionValidator {
  family?: ModelFamily
  validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult>
}

export interface MissionRunOptions {
  stateDir: string
  runnerConfig?: RunnerConfig
  rolePipeline?: RolePipeline
  /** Custom runner — defaults to RunnerManager with `mode: mock`. */
  runner?: { runTask(task: Task): Promise<RunResult> }
  workerRouter?: Pick<WorkerPoolRouter, 'decide'>
  workerSessions?: WorkerSession[]
  queueDepth?: number | (() => number)

  // Phase-4-onwards end-to-end glue (all injectable, all default to safe no-ops):
  validators?: MissionValidator[]
  riskFactors?: () => Promise<import('@aedev/validators').RiskFactors> | import('@aedev/validators').RiskFactors
  mergePolicy?: MergePolicy
  /** Browser QA driver — when `requiresUi=true` and this is set, runs against `smokeBaseUrl`. */
  browserQA?: BrowserQA
  /** URL passed to BrowserQA.run().  Default: a generated file:// reference under evidenceDir. */
  smokeBaseUrl?: string

  // Phase-7 preview wiring (runs BEFORE validators so they can see the preview URL):
  previewAdapter?: PreviewAdapter

  // Phase-7/8 release wiring (runs AFTER AUTO_MERGE):
  releasePipeline?: ReleasePipeline
  /** True iff this mission may execute the production-deploy path on AUTO_MERGE. */
  productionDeployEnabled?: boolean
  /** Healthcheck URL polled after production deploy. */
  healthcheckUrl?: string

  // Mission-level flags:
  requiresUi?: boolean
  requiresPreview?: boolean
  sensitiveLane?: boolean
  /** v2.3 default: never auto-merge; successful work waits as a draft PR candidate. */
  draftOnly?: boolean
}

export interface MissionRunResult {
  missionId: string
  taskId: string
  /** Overall outcome.  Reflects the merge decision when validators ran. */
  status: 'done' | 'failed' | 'waiting' | 'blocked'
  evidenceDir: string
  run: RunResult
  // New (workbook end-to-end):
  validatorResults: ValidatorResult[]
  riskScore: number
  riskLevel: 'low' | 'medium' | 'high'
  mergeDecision: MergePolicyDecision
  routeDecision?: RouteDecision
  validatorRouteDecision?: RouteDecision
  browserQAResult?: BrowserQAResult
  releaseResult?: ReleaseResult
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

    let task: Task | undefined
    let routeDecision: RouteDecision | undefined
    let run: RunResult | undefined
    try {
      const requiresUi = this.opts.requiresUi ?? heuristicRequiresUi(mission)
      const design = readMissionDesign(this.opts.stateDir, mission.id)

      // 1. Mission task + route selection.
      task = this.db.insertTask({
        missionId: mission.id,
        repoId: mission.repoId,
        title: `Implement mission: ${mission.title}`,
        prompt: buildTaskPrompt(mission, evidenceDir),
        status: 'pending',
        attemptNumber: 1,
      })

      routeDecision = this.routeRole('coder')
      writeRouteDecision(evidenceDir, routeDecision)
      this.db.insertEvent('mission.route_selected', 'mission', mission.id, {
        role: 'coder',
        provider: routeDecision.provider,
        sessionId: routeDecision.sessionId ?? null,
        concurrency: routeDecision.concurrency,
        holdCode: routeDecision.holdCode ?? null,
        reason: routeDecision.reason,
      })
      if (!routeDecision.provider) {
        return this.createHeldResult({
          mission,
          task,
          evidenceDir,
          routeDecision,
          reason: routeDecision.reason,
          holdCode: routeDecision.holdCode ?? 'HOLD-SESSION-POOL',
        })
      }

      const runner = this.opts.runner ?? new RunnerManager(this.db, buildRunnerConfig(this.opts, routeDecision))
      const moveRunner = new BoundedMoveRunner<MissionMoveContext>({
        db: this.db,
        taskId: task.id,
        evidenceDir,
      })
      const moveResult = await moveRunner.run(
        { mission, evidenceDir, task, requiresUi },
        buildMissionMoves({
          mission,
          design,
          evidenceDir,
          requiresUi,
          pipeline: this.opts.rolePipeline ?? new RolePipeline(),
          runner,
        }),
      )
      if (moveResult.failed) {
        return this.createHeldResult({
          mission,
          task,
          evidenceDir,
          routeDecision,
          reason: moveResult.failed.error,
          holdCode: 'HOLD-MOVE-FAILED',
          run: moveResult.ctx.run,
        })
      }
      run = moveResult.ctx.run
      if (!run) throw new Error('Mission DAG completed without a coder run result')
      ensureRequiredEvidence(evidenceDir)

      // 3. Bundle the evidence dir for downstream gates
      const bundle = readEvidenceBundle(evidenceDir)

      // 4. BrowserQA (UI missions).  We write the report INTO evidenceDir so it
      // overwrites the Phase-5 QA-role "Status: Pending" stub — MergePolicy's
      // hasScreenshotEvidence gate rejects that stub but accepts a real report.
      let browserQAResult: BrowserQAResult | undefined
      if (requiresUi) {
        const browserQA = this.opts.browserQA ?? new BrowserQA(new MockBrowserDriver(), { outputDir: evidenceDir })
        const url = this.opts.smokeBaseUrl ?? generatePreviewStub(evidenceDir, mission)
        browserQAResult = await browserQA.run(url)
        Object.assign(bundle, readEvidenceBundle(evidenceDir))
      }

      // 4b. External preview deploy (runs before validators so they see the URL).
      if (this.opts.requiresPreview && this.opts.previewAdapter) {
        const previewResult = await this.opts.previewAdapter.deploy({
          outputDir: evidenceDir,
          projectName: mission.repoId,
          branchName: `preview-${mission.id.slice(0, 8)}`,
        })
        if (previewResult.url) {
          writeFileSync(join(evidenceDir, 'preview-url.txt'), previewResult.url + '\n')
        }
        writeFileSync(join(evidenceDir, 'preview-meta.json'), JSON.stringify({
          provider: previewResult.provider,
          url: previewResult.url,
          deployedAt: previewResult.deployedAt,
          requiresSecretGrant: previewResult.requiresSecretGrant,
          requiredSecretName: previewResult.requiredSecretName,
          error: previewResult.error,
        }, null, 2))
        Object.assign(bundle, readEvidenceBundle(evidenceDir))
      }

      // 5. Risk scoring
      const factors = await Promise.resolve(this.opts.riskFactors?.() ?? defaultRiskFactors(bundle))
      const risk = RiskScorer.compute(factors)
      writeFileSync(join(evidenceDir, 'risk-report.md'), renderRiskReport(risk))
      Object.assign(bundle, readEvidenceBundle(evidenceDir))

      // 6. Validators (Gemini + OpenAI by default; injectable for tests)
      const validators = this.opts.validators ?? []
      const validatorResults: ValidatorResult[] = []
      const reviewerFamily = validators.length > 1 ? inferMissionValidatorFamily(validators[0]) : undefined
      const configuredFamilyConflict = findConfiguredFamilyConflict(validators)
      if (configuredFamilyConflict) {
        return this.createHeldResult({
          mission,
          task,
          evidenceDir,
          routeDecision,
          reason: configuredFamilyConflict.message,
          holdCode: 'HOLD-FAMILY-CONFLICT',
          run,
        })
      }
      const validatorRouteDecision = validators.length > 0 ? this.routeRole('validator', reviewerFamily) : undefined
      if (validatorRouteDecision) {
        writeRouteDecision(evidenceDir, validatorRouteDecision, 'validator-route.json')
        this.db.insertEvent('mission.route_selected', 'mission', mission.id, {
          role: 'validator',
          provider: validatorRouteDecision.provider,
          sessionId: validatorRouteDecision.sessionId ?? null,
          concurrency: validatorRouteDecision.concurrency,
          holdCode: validatorRouteDecision.holdCode ?? null,
          reason: validatorRouteDecision.reason,
        })
        if (!validatorRouteDecision.provider) {
          return this.createHeldResult({
            mission,
            task,
            evidenceDir,
            routeDecision,
            validatorRouteDecision,
            reason: validatorRouteDecision.reason,
            holdCode: validatorRouteDecision.holdCode ?? 'HOLD-FAMILY-CONFLICT',
            run,
          })
        }
      }
      for (const v of validators) {
        try {
          const result = await v.validate(task.id, bundle)
          const family = inferMissionValidatorFamily(v, result)
          const reviewer = validatorResults[0]
          if (reviewer) assertDifferentFamily(validatorResultToFamily(reviewer.validator), family)
          validatorResults.push(result)
        } catch (e) {
          if (e instanceof FamilyConflictError) {
            return this.createHeldResult({
              mission,
              task,
              evidenceDir,
              routeDecision,
              validatorRouteDecision,
              reason: e.message,
              holdCode: 'HOLD-FAMILY-CONFLICT',
              run,
            })
          }
          validatorResults.push({
            id: `error-${Date.now()}-${validatorResults.length}`,
            taskId: task.id,
            runId: run.runId,
            validator: 'mock',
            verdict: 'inconclusive',
            summary: `Validator threw: ${(e as Error).message}`,
            createdAt: new Date().toISOString(),
          })
        }
      }

      // 7. Merge policy
      const evidence: MergePolicyEvidence = {
        bundle,
        requiresScreenshots: requiresUi,
        requiresPreview: this.opts.requiresPreview ?? false,
        sensitiveLane: this.opts.sensitiveLane ?? false,
        secretScanHit: false,
        forbiddenPathTouched: false,
      }
      const policy = this.opts.mergePolicy ?? new MergePolicy()
      const policyDecision = policy.decide(risk.score, validatorResults, evidence)
      const decision: MergePolicyDecision =
        policyDecision === 'AUTO_MERGE' && this.opts.draftOnly !== false ? 'WAITING' : policyDecision
      if (policyDecision === 'AUTO_MERGE' && decision === 'WAITING') {
        this.db.insertEvent('mission.auto_merge_blocked', 'mission', mission.id, {
          reason: 'v2.3 draft-only policy',
          policyDecision,
        })
      }

      // 8. Release pipeline (only on AUTO_MERGE)
      let releaseResult: ReleaseResult | undefined
      if (decision === 'AUTO_MERGE' && this.opts.releasePipeline && this.opts.productionDeployEnabled) {
        releaseResult = await this.opts.releasePipeline.release({
          mission,
          decision,
          mergeSha: `mock-merge-${mission.id.slice(0, 8)}`,
          productionDeployEnabled: true,
          outputDir: evidenceDir,
          ...(this.opts.healthcheckUrl !== undefined ? { healthcheckUrl: this.opts.healthcheckUrl } : {}),
        })
      }

      // 9. Workbook summary
      const summaryStatus: MissionRunResult['status'] =
        run.exitCode !== 0 ? 'failed' :
        decision === 'AUTO_MERGE' ? 'done' :
        decision === 'BLOCKED' ? 'blocked' :
        'waiting'

      writeFileSync(join(evidenceDir, 'workbook-summary.md'), renderWorkbookSummary({
        mission, run, risk, validatorResults, decision, browserQAResult, releaseResult, status: summaryStatus,
      }))

      // 10. State machine
      const dbStatus = summaryStatus === 'done' ? 'done' : summaryStatus === 'failed' ? 'failed' : 'paused'
      this.db.updateMissionStatus(mission.id, dbStatus)
      this.db.insertEvent('mission.run_completed', 'mission', mission.id, {
        taskId: task.id,
        runId: run.runId,
        exitCode: run.exitCode,
        status: summaryStatus,
        decision,
        riskScore: risk.score,
        validatorCount: validatorResults.length,
        releaseDeployUrl: releaseResult?.deployUrl ?? null,
        releaseReverted: releaseResult?.reverted ?? false,
      })

      return {
        missionId: mission.id,
        taskId: task.id,
        status: summaryStatus,
        evidenceDir,
        run,
        validatorResults,
        riskScore: risk.score,
        riskLevel: risk.level,
        mergeDecision: decision,
        ...(routeDecision !== undefined ? { routeDecision } : {}),
        ...(validatorRouteDecision !== undefined ? { validatorRouteDecision } : {}),
        ...(browserQAResult !== undefined ? { browserQAResult } : {}),
        ...(releaseResult !== undefined ? { releaseResult } : {}),
      }
    } catch (e) {
      this.db.updateMissionStatus(mission.id, 'failed')
      this.db.insertEvent('mission.run_failed', 'mission', mission.id, { error: (e as Error).message })
      writeFileSync(join(evidenceDir, 'run-error.txt'), `${(e as Error).message}\n`)
      throw e
    }
  }

  private routeRole(role: 'coder' | 'validator', reviewerFamily?: ModelFamily): RouteDecision {
    const router = this.opts.workerRouter ?? (this.opts.workerSessions ? new WorkerPoolRouter(this.opts.workerSessions) : null)
    if (!router) {
      return {
        provider: role === 'coder' ? resolveProviderFromMode(this.opts.runnerConfig?.mode ?? 'mock') : 'openai-api',
        concurrency: 1,
        reason: 'worker router not configured',
      }
    }
    return router.decide({
      role,
      queueDepth: typeof this.opts.queueDepth === 'function' ? this.opts.queueDepth() : this.opts.queueDepth,
      ...(role === 'validator' ? { reviewerFamily } : {}),
    })
  }

  private createHeldResult(params: {
    mission: Mission
    task: Task
    evidenceDir: string
    routeDecision?: RouteDecision
    validatorRouteDecision?: RouteDecision
    reason: string
    holdCode: string
    run?: RunResult
  }): MissionRunResult {
    const run = params.run ?? {
      runId: `held-${params.task.id}`,
      taskId: params.task.id,
      exitCode: 0,
      evidenceDir: params.evidenceDir,
      durationMs: 0,
    }
    writeFileSync(join(params.evidenceDir, 'run-hold.json'), JSON.stringify({
      holdCode: params.holdCode,
      reason: params.reason,
      routeDecision: params.routeDecision,
      validatorRouteDecision: params.validatorRouteDecision,
    }, null, 2))
    writeFileSync(join(params.evidenceDir, 'workbook-summary.md'), renderWorkbookSummary({
      mission: params.mission,
      run,
      risk: { score: 0, level: 'low' },
      validatorResults: [],
      decision: 'WAITING',
      status: 'waiting',
    }))
    this.db.updateMissionStatus(params.mission.id, 'paused')
    this.db.updateTaskStatus(params.task.id, 'hold')
    this.db.insertEvent('mission.run_held', 'mission', params.mission.id, {
      taskId: params.task.id,
      holdCode: params.holdCode,
      reason: params.reason,
    })
    return {
      missionId: params.mission.id,
      taskId: params.task.id,
      status: 'waiting',
      evidenceDir: params.evidenceDir,
      run,
      validatorResults: [],
      riskScore: 0,
      riskLevel: 'low',
      mergeDecision: 'WAITING',
      ...(params.routeDecision !== undefined ? { routeDecision: params.routeDecision } : {}),
      ...(params.validatorRouteDecision !== undefined ? { validatorRouteDecision: params.validatorRouteDecision } : {}),
    }
  }
}

// ---------- helpers ----------

interface MissionMoveContext {
  mission: Mission
  evidenceDir: string
  task: Task
  requiresUi: boolean
  run?: RunResult
}

function buildMissionMoves(params: {
  mission: Mission
  design: MissionDesign | null
  evidenceDir: string
  requiresUi: boolean
  pipeline: RolePipeline
  runner: { runTask(task: Task): Promise<RunResult> }
}): Array<BoundedMove<MissionMoveContext>> {
  const orderedDag = topologicalMissionTasks(params.design)
  writeFileSync(join(params.evidenceDir, 'mission-dag.json'), JSON.stringify({
    missionId: params.mission.id,
    tasks: orderedDag.map((task) => ({
      id: task.id,
      role: task.role,
      parentIds: task.parentIds,
      writeFiles: task.writeFiles,
      expectedEvidence: task.expectedEvidence,
      checkpointGate: task.checkpointGate,
    })),
    serializedConflicts: detectWriteConflicts(orderedDag),
  }, null, 2))

  const moves: Array<BoundedMove<MissionMoveContext>> = [{
    id: 'role-pipeline',
    title: 'Run mission role pipeline',
    run: async (ctx) => {
      await params.pipeline.run(ctx.mission, ctx.evidenceDir, { requiresUi: ctx.requiresUi })
      return ctx
    },
  }]

  if (orderedDag.length === 0) {
    moves.push({
      id: 'worker-run',
      title: 'Run mission worker',
      tokenBudget: 20_000,
      run: async (ctx) => {
        const run = await params.runner.runTask(ctx.task)
        importTaskEvidence(run.evidenceDir, ctx.evidenceDir)
        return { ...ctx, run }
      },
    })
    return moves
  }

  const coderTaskId = orderedDag.find((task) => task.role === 'coder')?.id ?? orderedDag[0]?.id
  for (const dagTask of orderedDag) {
    moves.push({
      id: `dag-${dagTask.id}`,
      title: dagTask.title,
      tokenBudget: dagTask.role === 'coder' ? 20_000 : 4_000,
      run: async (ctx) => {
        if (dagTask.checkpointGate) {
          writeFileSync(join(ctx.evidenceDir, `${dagTask.id}-checkpoint.txt`), `${dagTask.checkpointGate}\n`)
        }
        if (dagTask.id === coderTaskId) {
          const run = await params.runner.runTask(ctx.task)
          importTaskEvidence(run.evidenceDir, ctx.evidenceDir)
          return { ...ctx, run }
        }
        writeFileSync(join(ctx.evidenceDir, `${dagTask.id}-move.md`), [
          `# ${dagTask.title}`,
          '',
          `Role: ${dagTask.role}`,
          `Expected evidence: ${dagTask.expectedEvidence.join(', ')}`,
          `Write files: ${dagTask.writeFiles.join(', ') || '(none)'}`,
          '',
        ].join('\n'))
        return ctx
      },
    })
  }
  return moves
}

function readMissionDesign(stateDir: string, missionId: string): MissionDesign | null {
  const path = join(stateDir, 'prd', `${missionId}.design.json`)
  if (!existsSync(path)) return null
  return JSON.parse(readFileSync(path, 'utf8')) as MissionDesign
}

function topologicalMissionTasks(design: MissionDesign | null): MissionDesign['taskDag'] {
  const tasks = design?.taskDag ?? []
  if (tasks.length === 0) return []
  const remaining = new Map(tasks.map((task) => [task.id, task]))
  const completed = new Set<string>()
  const ordered: MissionDesign['taskDag'] = []
  while (remaining.size > 0) {
    const ready = [...remaining.values()].filter((task) => task.parentIds.every((parent) => completed.has(parent)))
    if (ready.length === 0) throw new Error('Mission DAG contains a cycle or missing parent')
    for (const task of ready) {
      ordered.push(task)
      completed.add(task.id)
      remaining.delete(task.id)
    }
  }
  return ordered
}

function detectWriteConflicts(tasks: MissionDesign['taskDag']): Array<{ left: string; right: string; files: string[] }> {
  const conflicts: Array<{ left: string; right: string; files: string[] }> = []
  for (let i = 0; i < tasks.length; i++) {
    for (let j = i + 1; j < tasks.length; j++) {
      const left = tasks[i]
      const right = tasks[j]
      if (!left || !right) continue
      const files = left.writeFiles.filter((file) => right.writeFiles.includes(file))
      if (files.length > 0) conflicts.push({ left: left.id, right: right.id, files })
    }
  }
  return conflicts
}

function buildTaskPrompt(mission: Mission, evidenceDir: string): string {
  return [
    `Mission: ${mission.title}`,
    mission.description ? `Description: ${mission.description}` : '',
    `Evidence directory: ${evidenceDir}`,
    'Implement the smallest real change needed for this mission and produce plan, diff summary, tests, and done report.',
  ].filter(Boolean).join('\n\n')
}

function buildRunnerConfig(opts: MissionRunOptions, decision: RouteDecision): RunnerConfig {
  const base: RunnerConfig = opts.runnerConfig ?? {
    mode: 'mock',
    maxConcurrentWorkers: 1,
    worktreeBaseDir: join(opts.stateDir, 'worktrees'),
    outputBaseDir: join(opts.stateDir, 'evidence', 'tasks'),
  }
  return {
    ...base,
    mode: providerToRunnerMode(decision.provider),
    maxConcurrentWorkers: decision.concurrency,
  }
}

function providerToRunnerMode(provider: RouteDecision['provider']): RunnerConfig['mode'] {
  switch (provider) {
    case 'claude-cli': return 'claude-cli'
    case 'codex-cli': return 'codex-cli'
    case 'mock': return 'mock'
    default: return 'mock'
  }
}

function resolveProviderFromMode(mode: RunnerConfig['mode']): RouteDecision['provider'] {
  switch (mode) {
    case 'claude-cli': return 'claude-cli'
    case 'codex-cli': return 'codex-cli'
    case 'mock': return 'mock'
    default: return 'mock'
  }
}

function inferMissionValidatorFamily(validator: MissionValidator | undefined, result?: ValidatorResult): ModelFamily {
  if (validator?.family) return validator.family
  if (result) return validatorResultToFamily(result.validator)
  return 'mock'
}

function findConfiguredFamilyConflict(validators: MissionValidator[]): FamilyConflictError | null {
  if (validators.length < 2) return null
  const reviewer = inferMissionValidatorFamily(validators[0])
  for (const validator of validators.slice(1)) {
    const family = inferMissionValidatorFamily(validator)
    try {
      assertDifferentFamily(reviewer, family)
    } catch (error) {
      return error instanceof FamilyConflictError ? error : new FamilyConflictError(family)
    }
  }
  return null
}

function validatorResultToFamily(validator: ValidatorResult['validator']): ModelFamily {
  switch (validator) {
    case 'gemini': return 'google'
    case 'openai':
    case 'codex': return 'openai'
    case 'mock': return 'mock'
  }
}

function writeRouteDecision(evidenceDir: string, decision: RouteDecision, filename = 'worker-route.json'): void {
  writeFileSync(join(evidenceDir, filename), JSON.stringify(decision, null, 2))
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

function readEvidenceBundle(evidenceDir: string): Record<string, string> {
  const out: Record<string, string> = {}
  if (!existsSync(evidenceDir)) return out
  for (const entry of readdirSync(evidenceDir)) {
    const full = join(evidenceDir, entry)
    try {
      if (statSync(full).isFile()) out[entry] = readFileSync(full, 'utf-8')
    } catch { /* skip */ }
  }
  return out
}

function defaultRiskFactors(bundle: Record<string, string>): import('@aedev/validators').RiskFactors {
  const allText = Object.values(bundle).join('\n')
  return {
    touchesForbiddenPaths: /\b\.env\b|secrets\/|\.github\//.test(allText),
    diffLinesChanged: 0,
    hasDependencyChanges: /package\.json|pnpm-lock\.yaml|requirements\.txt/.test(allText),
    testCoverageDecreased: false,
    usesSecrets: false,
    hasMigrationChanges: /migration|ALTER TABLE/i.test(allText),
    hasControlPlaneChanges: false,
  }
}

function renderRiskReport(risk: { score: number; level: string; breakdown: Record<string, number> }): string {
  const lines = [
    '# Risk Report',
    '',
    `**Score:** ${risk.score}`,
    `**Level:** ${risk.level}`,
    '',
    '## Breakdown',
  ]
  for (const [k, v] of Object.entries(risk.breakdown)) lines.push(`- ${k}: ${v}`)
  return lines.join('\n') + '\n'
}

function heuristicRequiresUi(mission: Mission): boolean {
  const hay = `${mission.title} ${mission.description ?? ''}`.toLowerCase()
  return /(ui|page|landing|dashboard|component|frontend|button|form|design|visual|layout)/.test(hay)
}

function generatePreviewStub(evidenceDir: string, mission: Mission): string {
  const path = join(evidenceDir, 'preview-stub.html')
  writeFileSync(path, `<!doctype html><html><head><title>${mission.title}</title></head><body><main><h1>${mission.title}</h1><p>${mission.description ?? ''}</p></main></body></html>\n`)
  return `file://${path}`
}

function renderWorkbookSummary(p: {
  mission: Mission
  run: RunResult
  risk: { score: number; level: string }
  validatorResults: ValidatorResult[]
  decision: MergePolicyDecision
  browserQAResult?: BrowserQAResult
  releaseResult?: ReleaseResult
  status: MissionRunResult['status']
}): string {
  const lines: string[] = [
    `# Workbook Summary — ${p.mission.title}`,
    '',
    `**Mission:** ${p.mission.id}`,
    `**Status:** ${p.status}`,
    `**Decision:** ${p.decision}`,
    `**Risk:** ${p.risk.score} (${p.risk.level})`,
    '',
    '## Run',
    `- runId: ${p.run.runId}`,
    `- exitCode: ${p.run.exitCode}`,
    `- evidenceDir: ${p.run.evidenceDir}`,
    '',
    '## Validators',
  ]
  if (p.validatorResults.length === 0) lines.push('- (none configured)')
  for (const v of p.validatorResults) lines.push(`- ${v.validator}: ${v.verdict}${v.summary ? ` — ${v.summary}` : ''}`)
  lines.push('')
  if (p.browserQAResult) {
    lines.push('## Browser QA')
    lines.push(`- passed: ${p.browserQAResult.passed}`)
    lines.push(`- screenshots: ${p.browserQAResult.screenshots.length}`)
    lines.push(`- layoutPassed: ${p.browserQAResult.layoutPassed}`)
    lines.push(`- a11yPassed: ${p.browserQAResult.a11yPassed}`)
    lines.push('')
  }
  if (p.releaseResult) {
    lines.push('## Release')
    lines.push(`- deployUrl: ${p.releaseResult.deployUrl ?? '(none)'}`)
    lines.push(`- healthcheckPassed: ${p.releaseResult.healthcheckPassed}`)
    lines.push(`- reverted: ${p.releaseResult.reverted}`)
    if (p.releaseResult.incidentPath) lines.push(`- incident: ${p.releaseResult.incidentPath}`)
    lines.push('')
  }
  return lines.join('\n')
}

/** Convenience factory that wraps a PreviewAdapter as a DeployFn for ReleasePipeline. */
export function previewAdapterAsDeployFn(adapter: PreviewAdapter): DeployFn {
  return async (req: DeployRequest) => {
    const result: PreviewResult = await adapter.deploy({
      outputDir: req.outputDir,
      projectName: req.mission.repoId,
      branchName: req.branch,
    })
    return {
      url: result.url,
      meta: result.meta,
      ...(result.error !== undefined ? { error: result.error } : {}),
      ...(result.requiresSecretGrant ? { requiresSecretGrant: true } : {}),
      ...(result.requiredSecretName !== undefined ? { requiredSecretName: result.requiredSecretName } : {}),
    }
  }
}

/** Convenience: an in-memory GitClient that records reverts without invoking real git. */
export class MemoryGitClient implements GitClient {
  readonly reverts: Array<{ mergeSha: string; reason?: string; revertSha: string }> = []
  async resolveSha(ref: string): Promise<string> { return `sha-of-${ref}` }
  async revertMerge(mergeSha: string, opts?: { reason?: string }): Promise<string> {
    const revertSha = `revert-of-${mergeSha}-${Date.now()}`
    const entry: { mergeSha: string; reason?: string; revertSha: string } = { mergeSha, revertSha }
    if (opts?.reason !== undefined) entry.reason = opts.reason
    this.reverts.push(entry)
    return revertSha
  }
}
