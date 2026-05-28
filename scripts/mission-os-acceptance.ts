import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  AedevDb,
  validateMissionDesign,
  type Mission,
  type Repo,
  type RunResult,
  type Task,
  type ValidatorResult,
} from '@aedev/core'
import {
  buildStatusBoard,
  classifyIntakeCandidate,
  DraftPrGate,
  IntakeService,
  LeadAgent,
  MissionRunner,
  writeMissionOsAcceptanceReport,
  type AcceptanceCheck,
  type AcceptanceCommandResult,
  type AcceptanceRouteDecision,
  type MissionValidator,
  type RolePipeline,
} from '@aedev/daemon'
import { discoverWorkerSessions, WorkerPoolRouter, type WorkerSession } from '@aedev/runner'
import { buildEvidencePrompt, redactForValidator } from '@aedev/validators'

interface CliArgs {
  stageId: string
  outputRoot: string
  iterations: number
  requireRealSoak: boolean
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2))
  const startedAt = new Date()
  const outputDir = join(args.outputRoot, 'v23', args.stageId)
  mkdirSync(outputDir, { recursive: true })

  const commands = [
    runCommand('pnpm', ['test:mission-os:dry-soak', '--', '--iterations', String(args.iterations)], outputDir),
  ]
  const drySoakReport = join(process.cwd(), 'evidence', 'stage-v23', 'dry-soak', 'mission-os-dry-soak.json')
  const sessionHealthPath = await writeSessionHealthEvidence(outputDir)
  const routeDecisions = writeRouteEvidence(outputDir)
  const validatorLeakScan = writeValidatorLeakScan(outputDir)
  const sideEffectIdempotency = await writeSideEffectIdempotency(outputDir)
  const stageChecks = await writeStageSpecificChecks(args.stageId, outputDir, {
    routeDecisions,
    validatorLeakScan,
    sideEffectIdempotency,
  })
  const draftPr = {
    name: 'draft PR gate',
    passed: sideEffectIdempotency.passed,
    detail: sideEffectIdempotency.detail,
  }
  const realSoakReportPath = join(outputDir, 'real-soak.json')
  const realSoak = writeRealSoakPolicy(outputDir, realSoakReportPath, args.requireRealSoak)
  const holds = realSoak.passed ? [] : [realSoak.detail]
  const evidencePaths = [
    drySoakReport,
    sessionHealthPath,
    join(outputDir, 'route-decisions.json'),
    join(outputDir, 'validator-leak-scan.json'),
    join(outputDir, 'side-effect-idempotency.json'),
    join(outputDir, 'real-soak-policy.json'),
  ]
  if (existsSync(realSoakReportPath)) evidencePaths.push(realSoakReportPath)

  const report = writeMissionOsAcceptanceReport({
    stageId: args.stageId,
    startedAt: startedAt.toISOString(),
    endedAt: new Date().toISOString(),
    commands,
    evidencePaths,
    routeDecisions,
    stageChecks,
    validatorLeakScan,
    sideEffectIdempotency,
    draftPr,
    realSoak,
    holds,
  }, outputDir)

  console.log(JSON.stringify(report, null, 2))
  if (report.status === 'failed') process.exit(1)
  if (report.status === 'hold') process.exit(2)
}

async function writeStageSpecificChecks(
  stageId: string,
  outputDir: string,
  base: {
    routeDecisions: AcceptanceRouteDecision[]
    validatorLeakScan: AcceptanceCheck
    sideEffectIdempotency: AcceptanceCheck
  },
): Promise<AcceptanceCheck[]> {
  const checks: AcceptanceCheck[] = []
  const stageEvidenceDir = join(outputDir, 'stage-specific')
  mkdirSync(stageEvidenceDir, { recursive: true })
  const stage = stageNumber(stageId)

  if (stageId === 'audit' || stage === '1') checks.push(writeStage1Checks(stageEvidenceDir, base.routeDecisions))
  if (stageId === 'audit' || stage === '2') checks.push(writeStage2Checks(stageEvidenceDir))
  if (stageId === 'audit' || stage === '3') checks.push(writeStage3Checks(stageEvidenceDir))
  if (stageId === 'audit' || stage === '4' || stage === '6') checks.push(await writeStage4And6Checks(stageEvidenceDir))
  if (stageId === 'audit' || stage === '5') {
    checks.push({
      name: 'stage5 validator isolation',
      passed: base.validatorLeakScan.passed,
      detail: base.validatorLeakScan.detail,
    })
  }
  if (stageId === 'audit' || stage === '7') checks.push(writeStage7Checks(stageEvidenceDir))
  if (stageId === 'audit' || stage === '8' || stageId.startsWith('stage8-')) checks.push(writeStage8Checks(stageId, stageEvidenceDir))

  writeFileSync(join(stageEvidenceDir, 'stage-specific-checks.json'), JSON.stringify(checks, null, 2) + '\n')
  return checks
}

function stageNumber(stageId: string): string {
  const match = /^stage([1-8])\b/.exec(stageId)
  return match?.[1] ?? ''
}

function writeStage1Checks(outputDir: string, routeDecisions: AcceptanceRouteDecision[]): AcceptanceCheck {
  const coder = routeDecisions.find((decision) => decision.role === 'coder')
  const passed = coder?.provider === 'claude-cli' || coder?.provider === 'codex-cli'
  const check = {
    name: 'stage1 subscription worker routing',
    passed,
    detail: passed
      ? `coder routed to local subscription provider ${coder?.provider}`
      : `coder route did not use a local subscription provider: ${coder?.provider ?? 'none'}`,
  }
  writeFileSync(join(outputDir, 'stage1-routing.json'), JSON.stringify({ check, routeDecisions }, null, 2) + '\n')
  return check
}

function writeStage2Checks(outputDir: string): AcceptanceCheck {
  const agent = new LeadAgent(outputDir)
  const design = agent.designMission(
    'acceptance-stage2',
    'Add OAuth login with security review, dependency changes, rollback plan, docs impact, and CI validation.',
    'Add OAuth login',
  )
  const parsed = validateMissionDesign(design)
  const coderTasks = parsed.taskDag.filter((task) => task.role === 'coder')
  const passed =
    parsed.taskDag.length >= 3 &&
    parsed.prd.acceptanceCriteria.every((criterion) => criterion.trim().length > 0) &&
    parsed.prd.rollbackPlan.trim().length > 0 &&
    coderTasks.every((task) => task.writeFiles.length > 0) &&
    parsed.checkpoints.length > 0
  writeFileSync(join(outputDir, 'stage2-mission-design.json'), JSON.stringify(parsed, null, 2) + '\n')
  writeFileSync(join(outputDir, 'stage2-mission-design.md'), agent.renderDesignMarkdown(parsed))
  return {
    name: 'stage2 auditable mission design',
    passed,
    detail: passed
      ? `schema valid with ${parsed.taskDag.length} DAG tasks and ${parsed.checkpoints.length} checkpoints`
      : 'mission design missing required DAG tasks, AC, rollback, coder write files, or checkpoint',
  }
}

function writeStage3Checks(outputDir: string): AcceptanceCheck {
  const samples = [
    classifyForAcceptance({ id: 'todo-1', source: 'todo', title: 'TODO cleanup', body: 'TODO: cleanup router' }),
    classifyForAcceptance({ id: 'issue-1', source: 'github-issue', title: 'Fix bug', body: 'low risk', labels: ['aedev:auto'] }),
    classifyForAcceptance({ id: 'blocked-1', source: 'manual', title: 'Read .env', body: 'touch .env and secrets/key' }),
  ]
  const passed =
    samples[0]?.decision === 'proposal_only' &&
    samples[1]?.decision === 'execute_now' &&
    samples[2]?.decision === 'blocked'
  writeFileSync(join(outputDir, 'stage3-classifier.json'), JSON.stringify(samples, null, 2) + '\n')
  return {
    name: 'stage3 mixed intake classifier',
    passed,
    detail: passed ? 'TODO proposal_only, auto issue execute_now, secret touch blocked' : 'classifier decisions drifted',
  }
}

function classifyForAcceptance(candidate: {
  id: string
  source: 'manual' | 'roadmap' | 'github-issue' | 'todo' | 'failing-test'
  title: string
  body: string
  labels?: string[]
}) {
  return classifyIntakeCandidate(candidate)
}

async function writeStage4And6Checks(outputDir: string): Promise<AcceptanceCheck> {
  const stateDir = join(outputDir, 'runtime')
  mkdirSync(stateDir, { recursive: true })
  const db = new AedevDb(':memory:')
  try {
    const repoId = db.insertRepo({
      name: 'acceptance-runtime',
      path: stateDir,
      defaultBranch: 'main',
      enabled: true,
      testCommands: [],
      forbiddenPaths: [],
      riskRules: {},
      mergePolicy: 'low-risk',
    }).id
    const intake = new IntakeService(db, stateDir)
    const mission = intake.createMissionCandidate(repoId, 'Build a bounded DAG acceptance mission with validation and documentation.')
    intake.requestApproval(mission.id)
    intake.approveMission(mission.id, 'acceptance')
    const taskEvidenceDir = join(stateDir, 'task-evidence')
    mkdirSync(taskEvidenceDir, { recursive: true })
    writeFileSync(join(taskEvidenceDir, 'diff-summary.md'), '# Diff Summary\n\nChanged docs only.\n')
    writeFileSync(join(taskEvidenceDir, 'test-summary.md'), '# Test Summary\n\nTests pass.\n')
    writeFileSync(join(taskEvidenceDir, 'done-report.md'), '# Done\n\nDone.\n')
    const result = await new MissionRunner(db, {
      stateDir,
      rolePipeline: acceptanceRolePipeline(),
      runner: {
        async runTask(task: Task): Promise<RunResult> {
          return {
            runId: `acceptance-${task.id}`,
            taskId: task.id,
            exitCode: 0,
            evidenceDir: taskEvidenceDir,
            durationMs: 1,
          }
        },
      },
      validators: [
        fakeAcceptanceValidator('gemini'),
        fakeAcceptanceValidator('openai'),
      ],
      requiresUi: false,
    }).runMission(mission.id)
    const manifest = JSON.parse(readFileSync(join(result.evidenceDir, 'move-manifest.json'), 'utf8')) as {
      completed?: string[]
    }
    const dag = JSON.parse(readFileSync(join(result.evidenceDir, 'mission-dag.json'), 'utf8')) as {
      tasks?: unknown[]
    }
    const autoMergeBlocked = db.queryEvents({ type: 'mission.auto_merge_blocked', entityId: mission.id }).length
    const passed =
      Array.isArray(manifest.completed) &&
      manifest.completed.includes('role-pipeline') &&
      manifest.completed.some((move) => move.startsWith('dag-')) &&
      Array.isArray(dag.tasks) &&
      dag.tasks.length >= 3 &&
      result.mergeDecision === 'WAITING' &&
      autoMergeBlocked === 1
    writeFileSync(join(outputDir, 'stage4-6-runtime.json'), JSON.stringify({
      result: {
        status: result.status,
        mergeDecision: result.mergeDecision,
        evidenceDir: result.evidenceDir,
      },
      manifest,
      dag,
      autoMergeBlocked,
    }, null, 2) + '\n')
    return {
      name: 'stage4 stage6 bounded DAG and draft gate',
      passed,
      detail: passed
        ? `completed ${manifest.completed?.length ?? 0} moves and blocked auto-merge into WAITING`
        : 'bounded DAG manifest or draft-only auto-merge block missing',
    }
  } finally {
    db.close()
  }
}

function acceptanceRolePipeline(): RolePipeline {
  return {
    async run(_mission: Mission, evidenceDir: string) {
      writeFileSync(join(evidenceDir, 'plan.md'), '# Plan\n\nRun stage-specific acceptance DAG.\n')
      return {
        missionId: _mission.id,
        evidenceDir,
        rolesRun: ['acceptance-role'],
        bundle: { 'plan.md': '# Plan\n\nRun stage-specific acceptance DAG.\n' },
        notes: [],
        childTaskCount: 0,
      }
    },
  } as unknown as RolePipeline
}

function fakeAcceptanceValidator(validator: 'gemini' | 'openai'): MissionValidator {
  return {
    family: validator === 'gemini' ? 'google' : 'openai',
    async validate(taskId: string): Promise<ValidatorResult> {
      return {
        id: `${validator}-${taskId}`,
        taskId,
        runId: `${validator}-run`,
        validator,
        verdict: 'pass',
        summary: `${validator} acceptance pass`,
        createdAt: new Date().toISOString(),
      }
    },
  }
}

function writeStage7Checks(outputDir: string): AcceptanceCheck {
  const board = buildStatusBoard({
    missionsOpen: 2,
    missionsTotal: 3,
    tasksRunning: 1,
    tasksQueued: 4,
    holdsOpen: 0,
    approvalsPending: 1,
    sessionHealth: 'healthy',
    quotaFraction: 0.2,
    missionOs: {
      activeWorkers: 2,
      healthyWorkers: 3,
      workerProviders: { 'claude-cli': 1, 'codex-cli': 1, 'gemini-api': 1 },
      checkpointWaits: 1,
      draftPrWaits: 2,
      lastAcceptanceStatus: 'pass',
    },
  }, '2026-05-28T00:00:00.000Z')
  const passed =
    board.mission_os?.queue_depth === 4 &&
    board.mission_os.active_workers === 2 &&
    board.mission_os.last_acceptance_status === 'pass'
  writeFileSync(join(outputDir, 'stage7-dashboard.json'), JSON.stringify(board, null, 2) + '\n')
  return {
    name: 'stage7 mission_os dashboard contract',
    passed,
    detail: passed ? 'dashboard exposes queue, worker, checkpoint, draft PR, and acceptance status' : 'mission_os dashboard fields missing',
  }
}

function writeStage8Checks(stageId: string, outputDir: string): AcceptanceCheck {
  const packageJson = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
    scripts?: Record<string, string>
  }
  const hasScript = Boolean(packageJson.scripts?.['test:mission-os:guarded-soak'])
  const guardedReport = join(process.cwd(), 'evidence', 'v23', stageId, `guarded-soak-${stageId.includes('draft-pr') ? 'draft-pr' : stageId.includes('real') ? 'real' : 'mock'}`, 'guarded-soak.json')
  const reportPresent = existsSync(guardedReport)
  const passed = hasScript
  writeFileSync(join(outputDir, 'stage8-guarded-soak.json'), JSON.stringify({
    hasScript,
    guardedReport,
    reportPresent,
  }, null, 2) + '\n')
  return {
    name: 'stage8 guarded soak entrypoint',
    passed,
    detail: passed ? 'guarded soak script is wired; guarded reports are produced by the outer soak command' : 'guarded soak script missing',
  }
}

function readArgs(argv: string[]): CliArgs {
  return {
    stageId: readFlag(argv, '--stage') ?? 'audit',
    outputRoot: readFlag(argv, '--out') ?? join(process.cwd(), 'evidence'),
    iterations: Number(readFlag(argv, '--iterations') ?? '1'),
    requireRealSoak: argv.includes('--require-real-soak'),
  }
}

function readFlag(argv: string[], flag: string): string | undefined {
  const idx = argv.indexOf(flag)
  return idx >= 0 ? argv[idx + 1] : undefined
}

function runCommand(command: string, args: string[], outputDir: string): AcceptanceCommandResult {
  const startedAt = Date.now()
  const outPath = join(outputDir, `${command.replace(/[^a-z0-9_-]/gi, '_')}.out`)
  const errPath = join(outputDir, `${command.replace(/[^a-z0-9_-]/gi, '_')}.err`)
  const result = spawnSync(command, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: process.env,
  })
  writeFileSync(outPath, result.stdout ?? '')
  writeFileSync(errPath, result.stderr ?? '')
  return {
    command: [command, ...args].join(' '),
    exitCode: result.status ?? 1,
    durationMs: Date.now() - startedAt,
    stdoutPath: outPath,
    stderrPath: errPath,
  }
}

async function writeSessionHealthEvidence(outputDir: string): Promise<string> {
  const sessions = await discoverWorkerSessions()
  const path = join(outputDir, 'session-health.json')
  writeFileSync(path, JSON.stringify({
    checkedAt: new Date().toISOString(),
    sessions: sessions.map((session) => ({
      id: session.id,
      provider: session.provider,
      family: session.family,
      healthy: session.healthy,
      active: session.active,
      lastHeartbeatAt: session.lastHeartbeatAt,
      failureReason: session.failureReason ?? null,
    })),
  }, null, 2) + '\n')
  return path
}

function writeRouteEvidence(outputDir: string): AcceptanceRouteDecision[] {
  const sessions: WorkerSession[] = [
    { id: 'claude-audit', provider: 'claude-cli', family: 'anthropic', healthy: true, active: 1, lastHeartbeatAt: '2026-05-28T00:00:00.000Z' },
    { id: 'codex-audit', provider: 'codex-cli', family: 'openai', healthy: true, active: 0, lastHeartbeatAt: '2026-05-28T00:00:00.000Z' },
    { id: 'gemini-audit', provider: 'gemini-api', family: 'google', healthy: true, active: 0, lastHeartbeatAt: '2026-05-28T00:00:00.000Z' },
  ]
  const router = new WorkerPoolRouter(sessions)
  const coder = router.decide({ role: 'coder', queueDepth: 4 })
  const validator = router.decide({ role: 'validator', reviewerFamily: 'google', queueDepth: 4 })
  const decisions: AcceptanceRouteDecision[] = [
    {
      role: 'coder',
      provider: coder.provider,
      reason: coder.reason,
      ...(coder.holdCode ? { holdCode: coder.holdCode } : {}),
    },
    {
      role: 'validator',
      provider: validator.provider,
      reason: validator.reason,
      ...(validator.holdCode ? { holdCode: validator.holdCode } : {}),
    },
  ]
  writeFileSync(join(outputDir, 'route-decisions.json'), JSON.stringify(decisions, null, 2) + '\n')
  return decisions
}

function writeValidatorLeakScan(outputDir: string) {
  const forbidden = [
    'CODER_TRANSCRIPT_SHOULD_NOT_LEAK',
    'MODEL_NAME_SHOULD_NOT_LEAK',
    'TOKEN_COST_SHOULD_NOT_LEAK',
  ]
  const redacted = redactForValidator({
    'diff-summary.md': 'Changed README only.',
    'test-summary.md': 'Tests pass.',
    'coder-transcript.txt': forbidden[0] ?? '',
    'model-name.txt': forbidden[1] ?? '',
    'token-cost.json': forbidden[2] ?? '',
  })
  const prompt = buildEvidencePrompt({ taskId: 'acceptance-audit', bundle: redacted.bundle })
  const leaked = forbidden.filter((token) => prompt.includes(token))
  const detail = leaked.length === 0
    ? `0 forbidden tokens; removed ${redacted.removed.join(', ')}`
    : `leaked forbidden tokens: ${leaked.join(', ')}`
  const check = { name: 'validator leak scan', passed: leaked.length === 0, detail }
  writeFileSync(join(outputDir, 'validator-leak-scan.json'), JSON.stringify({
    ...check,
    removed: redacted.removed,
  }, null, 2) + '\n')
  return check
}

async function writeSideEffectIdempotency(outputDir: string) {
  const pushedKeys = new Set<string>()
  const prKeys = new Set<string>()
  const prs: Array<{ number: number; url: string; state: string; draft: true }> = []
  const gate = new DraftPrGate({ allowRemoteWrites: true }, {
    async pushBranch(_repo, _branch, idempotencyKey) {
      pushedKeys.add(idempotencyKey)
    },
  }, {
    async createDraftPr(_req) {
      if (!prKeys.has(_req.idempotencyKey)) {
        prKeys.add(_req.idempotencyKey)
        prs.push({ number: prs.length + 1, url: `https://example.test/pr/${prs.length + 1}`, state: 'open', draft: true })
      }
      return prs[0] ?? { number: 1, url: 'https://example.test/pr/1', state: 'open', draft: true }
    },
  })
  const req = {
    repo: fakeRepo(),
    missionId: 'mission-audit',
    title: 'Audit draft PR',
    branch: 'codex/audit',
    base: 'main',
    changedPaths: ['README.md'],
    evidenceUri: 'evidence://audit',
    riskScore: 5,
    validatorResults: [validatorResult()],
    rollbackNotes: 'Revert the README change.',
  }
  await gate.openDraftPr(req)
  await gate.openDraftPr(req)
  const passed = pushedKeys.size === 1 && prKeys.size === 1 && prs.length === 1
  const check = {
    name: 'side effect idempotency',
    passed,
    detail: passed ? 'same idempotency key reused; one draft PR created' : 'duplicate side effect observed',
  }
  writeFileSync(join(outputDir, 'side-effect-idempotency.json'), JSON.stringify({
    ...check,
    pushedKeys: [...pushedKeys],
    prKeys: [...prKeys],
    createdPrs: prs,
  }, null, 2) + '\n')
  return check
}

function writeRealSoakPolicy(outputDir: string, realSoakReportPath: string, requireRealSoak: boolean) {
  if (existsSync(realSoakReportPath)) {
    const report = JSON.parse(readFileSync(realSoakReportPath, 'utf8')) as { status?: string }
    const passed = report.status === 'pass'
    const check = {
      name: 'real soak policy',
      passed,
      detail: passed ? 'real subscription soak passed' : `real subscription soak status: ${report.status ?? 'unknown'}`,
    }
    writeFileSync(join(outputDir, 'real-soak-policy.json'), JSON.stringify(check, null, 2) + '\n')
    return check
  }
  const check = {
    name: 'real soak policy',
    passed: !requireRealSoak,
    detail: requireRealSoak
      ? 'real subscription soak is required for this stage and must be run by test:mission-os:real-soak'
      : 'audit harness records policy only; major stages must run real soak separately',
  }
  writeFileSync(join(outputDir, 'real-soak-policy.json'), JSON.stringify(check, null, 2) + '\n')
  return check
}

function fakeRepo(): Repo {
  return {
    id: 'repo-audit',
    name: 'audit',
    path: process.cwd(),
    defaultBranch: 'main',
    enabled: true,
    testCommands: [],
    forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    riskRules: {},
    mergePolicy: 'low-risk',
    createdAt: '2026-05-28T00:00:00.000Z',
    updatedAt: '2026-05-28T00:00:00.000Z',
  }
}

function validatorResult(): ValidatorResult {
  return {
    id: 'validator-audit',
    taskId: 'task-audit',
    runId: 'run-audit',
    validator: 'openai',
    verdict: 'pass',
    summary: 'Synthetic acceptance validator pass.',
    createdAt: new Date().toISOString(),
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
