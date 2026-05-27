import {
  copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync,
} from 'fs'
import { join } from 'path'
import type {
  AedevDb, Mission, RunnerConfig, RunResult, Task, ValidatorResult, MergePolicyDecision,
} from '@aedev/core'
import { RunnerManager } from '@aedev/runner'
import { MergePolicy, RiskScorer, type MergePolicyEvidence } from '@aedev/validators'
import { BrowserQA, MockBrowserDriver, type BrowserQAResult } from '@aedev/qa'
import type { PreviewAdapter, PreviewResult } from '@aedev/preview'
import { RolePipeline } from './roles/role-pipeline.js'
import { ReleasePipeline, type GitClient, type DeployFn, type DeployRequest, type ReleaseResult } from './release-pipeline.js'

/**
 * Mission validator contract.  Production wires real Gemini + OpenAI; tests
 * inject a stub.  Both are intentionally typed wider than the SDK classes so
 * the e2e smoke can run without API keys.
 */
export interface MissionValidator {
  validate(taskId: string, bundle: Record<string, string>): Promise<ValidatorResult>
}

export interface MissionRunOptions {
  stateDir: string
  runnerConfig?: RunnerConfig
  rolePipeline?: RolePipeline
  /** Custom runner — defaults to RunnerManager with `mode: mock`. */
  runner?: { runTask(task: Task): Promise<RunResult> }

  // Phase-4-onwards end-to-end glue (all injectable, all default to safe no-ops):
  validators?: MissionValidator[]
  riskFactors?: () => Promise<import('@aedev/validators').RiskFactors> | import('@aedev/validators').RiskFactors
  mergePolicy?: MergePolicy
  /** Browser QA driver — when `requiresUi=true` and this is set, runs against `smokeBaseUrl`. */
  browserQA?: BrowserQA
  /** URL passed to BrowserQA.run().  Default: a generated file:// reference under evidenceDir. */
  smokeBaseUrl?: string

  // Phase-7/8 release wiring:
  previewAdapter?: PreviewAdapter
  releasePipeline?: ReleasePipeline
  /** True iff this mission may execute the production-deploy path on AUTO_MERGE. */
  productionDeployEnabled?: boolean
  /** Healthcheck URL polled after production deploy. */
  healthcheckUrl?: string

  // Mission-level flags:
  requiresUi?: boolean
  requiresPreview?: boolean
  sensitiveLane?: boolean
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

    try {
      // 1. Role pipeline (PRD already on disk → architecture / design / tasks / etc.)
      const pipeline = this.opts.rolePipeline ?? new RolePipeline()
      const requiresUi = this.opts.requiresUi ?? heuristicRequiresUi(mission)
      await pipeline.run(mission, evidenceDir, { requiresUi })

      // 2. Builder task → worker run
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

      // 5. Risk scoring
      const factors = await Promise.resolve(this.opts.riskFactors?.() ?? defaultRiskFactors(bundle))
      const risk = RiskScorer.compute(factors)
      writeFileSync(join(evidenceDir, 'risk-report.md'), renderRiskReport(risk))
      Object.assign(bundle, readEvidenceBundle(evidenceDir))

      // 6. Validators (Gemini + OpenAI by default; injectable for tests)
      const validators = this.opts.validators ?? []
      const validatorResults: ValidatorResult[] = []
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
        forbiddenPathTouched: false,
      }
      const policy = this.opts.mergePolicy ?? new MergePolicy()
      const decision = policy.decide(risk.score, validatorResults, evidence)

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
