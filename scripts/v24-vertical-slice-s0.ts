/**
 * V2.4 S0 real vertical slice.
 *
 * Safety shape:
 * - clones CTlanston/multi-agent-brainstorm into a dedicated local copy whose
 *   path contains spaces;
 * - worker edits a second per-task clone made from that copy;
 * - no push, no PR, no merge;
 * - objective gates and local commit evidence are written under evidence/v24/s0.
 */
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { MissionRunner, type MissionValidator, type MissionRunOptions } from '@aedev/daemon'
import { MergePolicy, GeminiValidator, OpenAIValidator } from '@aedev/validators'

const repoUrl = process.env['V24_TARGET_REPO_URL'] ?? 'https://github.com/CTlanston/multi-agent-brainstorm.git'
const safeCopy = process.env['V24_TARGET_COPY_PATH'] ?? '/Users/lanston/projects/multi-agent-brainstorm v24 slice'
const stateDir = process.env['V24_STATE_DIR'] ?? join(process.cwd(), 'evidence', 'v24', 's0', 'state')
const reportPath = join(process.cwd(), 'evidence', 'v24', 's0', 'report.md')

async function main(): Promise<void> {
  mkdirSync(join(process.cwd(), 'evidence', 'v24', 's0'), { recursive: true })
  ensureSafeCopy()

  const db = new AedevDb(':memory:')
  try {
    const testCommands = detectTestCommands(safeCopy)
    const repo = db.insertRepo({
      name: 'multi-agent-brainstorm-v24-slice',
      path: safeCopy,
      githubOwner: 'CTlanston',
      githubRepo: 'multi-agent-brainstorm',
      defaultBranch: 'main',
      enabled: true,
      testCommands,
      forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
      riskRules: {},
      mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({
      repoId: repo.id,
      title: 'V2.4 S0 vertical slice note',
      description: [
        'Add the smallest low-risk evidence-only repository note for claude-code-247 V2.4 S0.',
        'Prefer a docs or README-adjacent note. Do not change runtime behavior.',
        'Run the detected validation commands and stop at local evidence plus local commit.',
      ].join(' '),
      status: 'approved',
      riskLevel: 'low',
    })

    const validators = buildValidators()
    if (validators.length < 2) {
      db.insertEvent('hold.validator.keys', 'mission', mission.id, {
        holdCode: 'HOLD-VALIDATOR-KEYS',
        reason: 'Gemini and OpenAI keys are both required for Phase 5 dual-family validation; S0 continues with objective gates only.',
        configuredValidators: validators.length,
      })
    }

    const opts: MissionRunOptions = {
      stateDir,
      runnerConfig: {
        mode: 'claude-cli',
        maxConcurrentWorkers: 1,
        worktreeBaseDir: join(stateDir, 'worktrees'),
        outputBaseDir: join(stateDir, 'task-evidence'),
        sourceRepoPath: safeCopy,
        testCommands,
        forbiddenPaths: repo.forbiddenPaths,
        createLocalCommit: true,
        branchPrefix: 'v24-s0',
      },
      validators,
      mergePolicy: new WaitingOnlyPolicy(),
      riskFactors: () => ({
        touchesForbiddenPaths: false,
        diffLinesChanged: 2,
        hasDependencyChanges: false,
        testCoverageDecreased: false,
        usesSecrets: false,
        hasMigrationChanges: false,
        hasControlPlaneChanges: false,
      }),
      requiresUi: false,
      requiresDualValidatorGate: validators.length >= 2,
    }
    const result = await new MissionRunner(db, opts).runMission(mission.id)
    const events = db.queryEvents({ entityId: mission.id, limit: 100 })
    writeFileSync(reportPath, renderReport({
      repoUrl,
      safeCopy,
      testCommands,
      result,
      events,
      validatorsConfigured: validators.length,
    }))
    console.log(`V2.4 S0 report: ${reportPath}`)
    console.log(`V2.4 S0 evidence: ${result.evidenceDir}`)
    if (result.run.exitCode !== 0) process.exitCode = 1
  } finally {
    db.close()
  }
}

function ensureSafeCopy(): void {
  if (existsSync(join(safeCopy, '.git'))) {
    execFileSync('git', ['fetch', '--all', '--prune'], { cwd: safeCopy, stdio: 'inherit' })
    execFileSync('git', ['switch', 'main'], { cwd: safeCopy, stdio: 'inherit' })
    execFileSync('git', ['pull', '--ff-only'], { cwd: safeCopy, stdio: 'inherit' })
    return
  }
  rmSync(safeCopy, { recursive: true, force: true })
  mkdirSync(join(safeCopy, '..'), { recursive: true })
  execFileSync('git', ['clone', repoUrl, safeCopy], { stdio: 'inherit' })
}

function detectTestCommands(repoPath: string): string[] {
  const commands: string[] = []
  if (existsSync(join(repoPath, 'validate.sh'))) commands.push('./validate.sh')
  if (existsSync(join(repoPath, 'scripts', 'validate.sh'))) commands.push('bash scripts/validate.sh')
  if (existsSync(join(repoPath, 'package.json'))) {
    const pkg = JSON.parse(readFileSync(join(repoPath, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }
    if (pkg.scripts?.['validate']) commands.push('pnpm run validate')
    else if (pkg.scripts?.['test']) commands.push('pnpm test')
    if (pkg.scripts?.['audit:multi-round']) commands.push('pnpm run audit:multi-round')
  }
  if (commands.length === 0 && existsSync(join(repoPath, 'scripts', 'audit_multi_round.js'))) commands.push('node scripts/audit_multi_round.js')
  return [...new Set(commands)]
}

function buildValidators(): MissionValidator[] {
  const validators: MissionValidator[] = []
  const geminiKey = process.env['AEDEV_GEMINI_API_KEY'] ?? process.env['GEMINI_API_KEY'] ?? process.env['GOOGLE_API_KEY']
  const openaiKey = process.env['AEDEV_OPENAI_API_KEY'] ?? process.env['OPENAI_API_KEY']
  if (geminiKey) validators.push(new GeminiValidator({ apiKey: geminiKey }))
  if (openaiKey) validators.push(new OpenAIValidator({ apiKey: openaiKey }))
  return validators
}

class WaitingOnlyPolicy extends MergePolicy {
  override decide(score: number, validators: Parameters<MergePolicy['decide']>[1], evidence: Parameters<MergePolicy['decide']>[2]) {
    const decision = super.decide(score, validators, evidence)
    return decision === 'AUTO_MERGE' ? 'WAITING' : decision
  }
}

function renderReport(input: {
  repoUrl: string
  safeCopy: string
  testCommands: string[]
  result: Awaited<ReturnType<MissionRunner['runMission']>>
  events: Array<{ type: string; payload: Record<string, unknown>; createdAt: string }>
  validatorsConfigured: number
}): string {
  return [
    '# V2.4 S0 Vertical Slice Evidence',
    '',
    `Date: ${new Date().toISOString()}`,
    `Repo URL: ${input.repoUrl}`,
    `Safe copy: ${input.safeCopy}`,
    `Worker evidence: ${input.result.evidenceDir}`,
    `Run exit code: ${input.result.run.exitCode}`,
    `Merge decision: ${input.result.mergeDecision} (remote writes disabled by design for S0)`,
    `Validators configured: ${input.validatorsConfigured}`,
    '',
    '## Objective Gates',
    ...(input.testCommands.length ? input.testCommands.map((c) => `- ${c}`) : ['- No validate/test/audit command discovered.']),
    '',
    '## Events',
    ...input.events.map((e) => `- ${e.createdAt} ${e.type} ${JSON.stringify(e.payload)}`),
    '',
    '## Result',
    `- status: ${input.result.status}`,
    `- taskId: ${input.result.taskId}`,
    `- runId: ${input.result.run.runId}`,
    `- risk: ${input.result.riskScore} (${input.result.riskLevel})`,
    `- validators: ${input.result.validatorResults.map((v) => `${v.validator}:${v.verdict}`).join(', ') || '(none)'}`,
  ].join('\n') + '\n'
}

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})
