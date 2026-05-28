import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Repo, ValidatorResult } from '@aedev/core'
import {
  DraftPrGate,
  writeMissionOsAcceptanceReport,
  type AcceptanceCommandResult,
  type AcceptanceRouteDecision,
} from '@aedev/daemon'
import { WorkerPoolRouter, type WorkerSession } from '@aedev/runner'
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
  const routeDecisions = writeRouteEvidence(outputDir)
  const validatorLeakScan = writeValidatorLeakScan(outputDir)
  const sideEffectIdempotency = await writeSideEffectIdempotency(outputDir)
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

function writeRouteEvidence(outputDir: string): AcceptanceRouteDecision[] {
  const sessions: WorkerSession[] = [
    { id: 'claude-audit', provider: 'claude-cli', family: 'anthropic', healthy: true, active: 1 },
    { id: 'codex-audit', provider: 'codex-cli', family: 'openai', healthy: true, active: 0 },
    { id: 'gemini-audit', provider: 'gemini-api', family: 'google', healthy: true, active: 0 },
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
