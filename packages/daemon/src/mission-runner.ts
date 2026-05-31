import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'fs'
import { join } from 'path'
import type {
  AedevDb, Mission, RunnerConfig, RunResult, Task, ValidatorResult, MergePolicyDecision,
} from '@aedev/core'
import { RunnerManager, WorkerPoolRouter, type ModelFamily, type RouteDecision, type WorkerSession } from '@aedev/runner'
import { MergePolicy, RiskScorer, type MergePolicyEvidence } from '@aedev/validators'
import { BrowserQA, MockBrowserDriver, type BrowserQAResult } from '@aedev/qa'
import type { PreviewAdapter, PreviewResult } from '@aedev/preview'
import { RolePipeline } from './roles/role-pipeline.js'
import { skipFinalWriteIfCancelled } from './cancellation.js'
import { ReleasePipeline, type GitClient, type DeployFn, type DeployRequest, type ReleaseResult } from './release-pipeline.js'
import { DraftPrGateError, type DraftPrRequest, type DraftPrInfo } from './draft-pr-gate.js'

/**
 * Mission validator contract.  Production wires real Gemini + OpenAI; tests
 * inject a stub.  Both are intentionally typed wider than the SDK classes so
 * the e2e smoke can run without API keys.
 */
export interface MissionValidator {
  validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult>
}

export interface MissionValidatorFactoryContext {
  missionId: string
  taskId: string
}

export type MissionValidatorFactory = (ctx: MissionValidatorFactoryContext) => MissionValidator[] | Promise<MissionValidator[]>

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
  /** Production default validator injection; called after the task id exists. */
  validatorFactory?: MissionValidatorFactory
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
  /** Defaults true when two or more validators are configured. */
  requiresDualValidatorGate?: boolean

  /** Optional long-lived cost roller (the daemon injects one); fed once per model.usage.recorded. */
  costRoller?: { record(sample: { ts: string; costUsd: number; bucket?: string }): void }

  /**
   * Injected autonomous draft-PR executor.  The daemon wires this as a
   * `DraftPrGate` over `GhGitRemoteWriter` + `GhDraftPrCreator` (the runner
   * plane).  When present and the decision is AUTO_MERGE, the loop opens a REAL
   * draft PR instead of stopping at a mock merge — the gate itself fail-closes
   * on allow_remote_writes / repo.enabled / forbidden paths, so leaving this
   * unset (or remote writes disabled) preserves the no-push default.
   */
  draftPrExecutor?: { openDraftPr(req: DraftPrRequest): Promise<DraftPrInfo> }
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
  /** Set when the autonomous loop opened a real draft PR (gate was open). */
  draftPr?: DraftPrInfo
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
      // 1. Role pipeline (PRD already on disk → architecture / design / tasks / etc.)
      const pipeline = this.opts.rolePipeline ?? new RolePipeline()
      const requiresUi = this.opts.requiresUi ?? heuristicRequiresUi(mission)
      await pipeline.run(mission, evidenceDir, { requiresUi })

      // 2. Builder task → worker run
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
      run = await runner.runTask(task)
      importTaskEvidence(run.evidenceDir, evidenceDir)
      ensureRequiredEvidence(evidenceDir)
      this.persistModelUsage(mission.id, task.id, run, routeDecision.provider)

      // 3. Bundle the evidence dir for downstream gates
      const bundle = readEvidenceBundle(evidenceDir)

      // 3b. Real-diff forbidden-path signal.  The runner writes changed-paths.json
      // (the actual `git diff` file list, computed in the worker/runner plane) into
      // evidence; we gate on those paths, not on regexing evidence prose.  Feeds
      // both risk scoring and the merge gate's hard BLOCK.
      const changedPaths = readChangedPaths(evidenceDir)
      const repoForGate = this.db.getRepo(mission.repoId)
      const forbiddenPatterns = repoForGate?.forbiddenPaths?.length ? repoForGate.forbiddenPaths : DEFAULT_FORBIDDEN_PATHS
      const forbiddenPathTouched = changedPaths.some((p) => forbiddenPatterns.some((pat) => forbiddenMatch(pat, p)))

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
      const factors = await Promise.resolve(this.opts.riskFactors?.() ?? defaultRiskFactors(bundle, forbiddenPathTouched))
      const risk = RiskScorer.compute(factors)
      writeFileSync(join(evidenceDir, 'risk-report.md'), renderRiskReport(risk))
      Object.assign(bundle, readEvidenceBundle(evidenceDir))

      // 6. Validators (Gemini + OpenAI by default; injectable for tests)
      const validators = this.opts.validators ??
        await Promise.resolve(this.opts.validatorFactory?.({ missionId: mission.id, taskId: task.id }) ?? [])
      const validatorResults: ValidatorResult[] = []
      const validatorRouteDecision = validators.length > 0 ? this.routeRole('validator', routeDecision.provider) : undefined
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
          validatorResults.push(await v.validate(task.id, bundle))
        } catch (e) {
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
        forbiddenPathTouched,
        coderFamily: providerToFamily(routeDecision.provider),
        requireIndependentValidatorFamilies: this.requiresDualValidatorGate(),
      }
      const policy = this.opts.mergePolicy ?? new MergePolicy()
      const decision = policy.decide(risk.score, validatorResults, evidence)

      // 7b. Autonomous draft PR (draft-pr-only autonomy).  On AUTO_MERGE, open a
      // REAL draft PR through the injected gate instead of a mock merge.  The
      // gate fail-closes on allow_remote_writes / repo.enabled / forbidden paths;
      // we attempt only when the coder produced a real branch + changed files.
      const localCommit = readLocalCommit(evidenceDir)
      let draftPr: DraftPrInfo | undefined
      if (decision === 'AUTO_MERGE' && this.opts.draftPrExecutor && repoForGate && localCommit?.branch && changedPaths.length > 0) {
        const worktreeBaseDir = this.opts.runnerConfig?.worktreeBaseDir ?? join(this.opts.stateDir, 'worktrees')
        const request: DraftPrRequest = {
          repo: { ...repoForGate, path: join(worktreeBaseDir, task.id) },
          missionId: mission.id,
          title: mission.title,
          branch: localCommit.branch,
          base: repoForGate.defaultBranch,
          changedPaths,
          evidenceUri: evidenceDir,
          riskScore: risk.score,
          validatorResults,
          rollbackNotes: 'Close the draft PR; nothing was merged (draft-pr-only autonomy).',
        }
        try {
          draftPr = await this.opts.draftPrExecutor.openDraftPr(request)
          this.db.updateMissionGitHub(mission.id, {
            githubBranch: localCommit.branch, githubPrUrl: draftPr.url, githubPrNumber: draftPr.number,
          })
          this.db.insertEvent('mission.draft_pr_opened', 'mission', mission.id, {
            url: draftPr.url, number: draftPr.number, branch: localCommit.branch, changedPaths,
          })
        } catch (e) {
          const code = e instanceof DraftPrGateError ? e.code : 'DRAFT_PR_BLOCKED'
          this.db.insertEvent('mission.draft_pr_blocked', 'mission', mission.id, {
            code, reason: (e as Error).message, branch: localCommit.branch,
          })
        }
      }

      // 8. Release pipeline (only on AUTO_MERGE)
      let releaseResult: ReleaseResult | undefined
      if (decision === 'AUTO_MERGE' && this.opts.releasePipeline && this.opts.productionDeployEnabled) {
        releaseResult = await this.opts.releasePipeline.release({
          mission,
          decision,
          // Real merged-branch SHA when the coder committed one; the literal
          // mock-merge placeholder only remains for runners that never commit.
          mergeSha: localCommit?.sha ?? `mock-merge-${mission.id.slice(0, 8)}`,
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

      // 10. State machine — but never clobber an operator cancel (Stop fence).
      const dbStatus = summaryStatus === 'done' ? 'done' : summaryStatus === 'failed' ? 'failed' : 'paused'
      if (!skipFinalWriteIfCancelled(this.db, mission.id, 'mission-runner.complete', dbStatus)) {
        this.db.updateMissionStatus(mission.id, dbStatus)
      }
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
        draftPrUrl: draftPr?.url ?? null,
        draftPrNumber: draftPr?.number ?? null,
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
        ...(draftPr !== undefined ? { draftPr } : {}),
      }
    } catch (e) {
      if (!skipFinalWriteIfCancelled(this.db, mission.id, 'mission-runner.failed')) {
        this.db.updateMissionStatus(mission.id, 'failed')
      }
      this.db.insertEvent('mission.run_failed', 'mission', mission.id, { error: (e as Error).message })
      writeFileSync(join(evidenceDir, 'run-error.txt'), `${(e as Error).message}\n`)
      throw e
    }
  }

  private routeRole(role: 'coder' | 'validator', reviewerProvider?: RouteDecision['provider']): RouteDecision {
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
      ...(role === 'coder' ? { requiresIndependentValidators: this.requiresDualValidatorGate() } : {}),
      ...(role === 'validator' ? { reviewerFamily: providerToFamily(reviewerProvider) } : {}),
    })
  }

  /**
   * Persist real token usage from the coder run.  The local CLI / docker
   * runners write `model-usage.json` into the run's evidence dir; we read it,
   * record a row in `model_usage`, emit `model.usage.recorded` (event first /
   * table write — GR#6 pattern: domain row + audit event), and feed an optional
   * cost roller.  No-op when the runner produced no usage file (e.g. mock).
   */
  private persistModelUsage(
    missionId: string,
    taskId: string,
    run: RunResult,
    coderProvider: RouteDecision['provider'],
  ): void {
    const path = join(run.evidenceDir, 'model-usage.json')
    if (!existsSync(path)) return
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    } catch {
      return
    }
    const inputTokens = Number(parsed['inputTokens'] ?? 0)
    const outputTokens = Number(parsed['outputTokens'] ?? 0)
    const costUsd = typeof parsed['costUsd'] === 'number' ? parsed['costUsd'] : null
    const provider = typeof parsed['provider'] === 'string' ? parsed['provider'] : (coderProvider ?? 'unknown')
    const model = typeof parsed['model'] === 'string' ? parsed['model'] : undefined
    const authMode = coderProviderToAuthMode(coderProvider)
    // model_usage.run_id FKs runs(id); injected/fake runners hand back a
    // synthetic runId with no row, so only set it when the run actually exists.
    const runId = this.db.getRun(run.runId) ? run.runId : undefined

    const usage = this.db.insertModelUsage({
      taskId,
      ...(runId !== undefined ? { runId } : {}),
      authMode,
      provider,
      inputTokens,
      outputTokens,
      ...(model !== undefined ? { model } : {}),
      ...(costUsd !== null ? { costUsd } : {}),
    })
    this.db.insertEvent('model.usage.recorded', 'mission', missionId, {
      taskId,
      runId: runId ?? null,
      usageId: usage.id,
      provider,
      authMode,
      inputTokens,
      outputTokens,
      costUsd,
    })
    if (this.opts.costRoller && costUsd !== null) {
      this.opts.costRoller.record({ ts: usage.createdAt, costUsd, bucket: missionId })
    }
  }

  private requiresDualValidatorGate(): boolean {
    return this.opts.requiresDualValidatorGate ??
      (this.opts.validators ? this.opts.validators.length >= 2 : Boolean(this.opts.validatorFactory))
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
    case 'claude-docker': return 'claude-docker'
    case 'claude-cli': return 'claude-cli'
    case 'codex-cli': return 'codex-cli'
    case 'mock': return 'mock'
    default: return 'mock'
  }
}

function resolveProviderFromMode(mode: RunnerConfig['mode']): RouteDecision['provider'] {
  switch (mode) {
    case 'claude-docker': return 'claude-docker'
    case 'claude-cli': return 'claude-cli'
    case 'codex-cli': return 'codex-cli'
    case 'mock': return 'mock'
    default: return 'mock'
  }
}

function providerToFamily(provider: RouteDecision['provider'] | undefined): ModelFamily | undefined {
  switch (provider) {
    case 'claude-docker':
    case 'claude-cli': return 'anthropic'
    case 'codex-cli':
    case 'openai-api': return 'openai'
    case 'gemini-api': return 'google'
    case 'mock': return 'mock'
    default: return undefined
  }
}

/** Map the coder provider to the auth_mode recorded in model_usage. */
function coderProviderToAuthMode(provider: RouteDecision['provider'] | undefined): string {
  switch (provider) {
    case 'claude-docker':
    case 'claude-cli': return 'local_claude_code'
    case 'codex-cli':
    case 'openai-api':
    case 'gemini-api': return 'api'
    case 'mock': return 'mock'
    default: return 'unknown'
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
  const workerAuthoritativeEvidence = new Set([
    'plan.md',
    'diff-summary.md',
    'test-summary.md',
    'done-report.md',
    'transcript-summary.md',
  ])
  for (const entry of readdirSync(taskEvidenceDir)) {
    const src = join(taskEvidenceDir, entry)
    if (!statSync(src).isFile()) continue
    const dest = join(missionEvidenceDir, entry)
    if (!existsSync(dest) || workerAuthoritativeEvidence.has(entry)) copyFileSync(src, dest)
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

function defaultRiskFactors(bundle: Record<string, string>, forbiddenPathTouched: boolean): import('@aedev/validators').RiskFactors {
  const allText = Object.values(bundle).join('\n')
  return {
    // Real-diff signal (changed-paths.json) — not a regex over evidence prose.
    touchesForbiddenPaths: forbiddenPathTouched,
    diffLinesChanged: 0,
    hasDependencyChanges: /package\.json|pnpm-lock\.yaml|requirements\.txt/.test(allText),
    testCoverageDecreased: false,
    usesSecrets: false,
    hasMigrationChanges: /migration|ALTER TABLE/i.test(allText),
    hasControlPlaneChanges: false,
  }
}

/** CLAUDE.md non-negotiable #3 default forbidden paths, used when a repo
 *  registry entry has none of its own. */
const DEFAULT_FORBIDDEN_PATHS = ['.env*', 'secrets/**', '.github/**', 'CLAUDE.md', 'AGENTS.md']

/** Read the runner-emitted real git-diff file list from evidence. Empty when
 *  the runner produced none (e.g. the mock runner does not touch a worktree). */
function readChangedPaths(evidenceDir: string): string[] {
  const path = join(evidenceDir, 'changed-paths.json')
  if (!existsSync(path)) return []
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { changedPaths?: unknown }
    return Array.isArray(parsed.changedPaths)
      ? parsed.changedPaths.filter((p): p is string => typeof p === 'string')
      : []
  } catch {
    return []
  }
}

/** Read the runner-emitted local commit info (branch + sha) from evidence.
 *  cli-runner writes local-commit.json; absent for the mock runner. */
function readLocalCommit(evidenceDir: string): { branch?: string; sha?: string } | undefined {
  const path = join(evidenceDir, 'local-commit.json')
  if (!existsSync(path)) return undefined
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as { branch?: unknown; sha?: unknown }
    const out: { branch?: string; sha?: string } = {}
    if (typeof parsed.branch === 'string' && parsed.branch) out.branch = parsed.branch
    if (typeof parsed.sha === 'string' && parsed.sha) out.sha = parsed.sha
    return out
  } catch {
    return undefined
  }
}

/** Glob matcher for forbidden-path patterns: `secrets/**`, `.github/**`, `.env*`,
 *  and exact paths like `CLAUDE.md`. Mirrors the runner's pathMatches. */
function forbiddenMatch(pattern: string, path: string): boolean {
  if (pattern.endsWith('/**')) {
    const base = pattern.slice(0, -3)
    return path === base || path.startsWith(base + '/')
  }
  if (pattern.endsWith('*')) return path.startsWith(pattern.slice(0, -1))
  return path === pattern
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
