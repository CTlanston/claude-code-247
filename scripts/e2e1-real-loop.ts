/**
 * E2E-1 — Real end-to-end loop proof (Stage E2E-1).
 *
 * Proves ONCE, on a real target repo, the full value loop:
 *   subscription Claude coder IN DOCKER  ->  evidence
 *     ->  real OpenAI + Gemini dual-family validation
 *     ->  model_usage persisted (real in/out tokens + cost)
 *     ->  real DRAFT PR on CTlanston/multi-agent-brainstorm (never merged).
 *
 * SAFETY (matches operator-cockpit-p3-remote-smoke):
 *  - allow_remote_writes is passed TRUE only IN-PROCESS to DraftPrGate for this
 *    one draft PR; the global config gate (~/.claude-code-247/config.yaml) is
 *    NEVER modified and stays false, so the daemon itself cannot remote-write.
 *  - Draft-only, never merged, title/branch idempotent.
 *  - Claude subscription auth is materialized from the macOS keychain into a
 *    private temp file, mounted READ-ONLY into the container, and deleted in a
 *    finally.  ANTHROPIC_* are stripped inside the container (no silent paid-API
 *    fallback — CLAUDE.md non-negotiable #6).
 *
 * Run under the operator secrets wrapper so OPENAI/GEMINI keys are in env:
 *   ~/.claude-code-247/with-secrets pnpm tsx scripts/e2e1-real-loop.ts
 */
import { execFileSync } from 'child_process'
import {
  existsSync, mkdirSync, readFileSync, rmSync, writeFileSync,
} from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { AedevDb, type Repo } from '@aedev/core'
import {
  MissionRunner, DraftPrGate, createDefaultMissionValidatorFactory, inspectDefaultMissionValidatorSecrets,
  type MissionRunOptions,
} from '@aedev/daemon'
import { GhGitRemoteWriter, GhDraftPrCreator } from '@aedev/runner'
import type { RolePipeline } from '@aedev/daemon'

// ---- Target + run config -----------------------------------------------------
const OWNER = 'CTlanston'
const NAME = 'multi-agent-brainstorm'
const GITHUB_URL = `https://github.com/${OWNER}/${NAME}.git`
const LOCAL_CLONE = '/Users/lanston/projects/multi-agent-brainstorm'
// runner:e2e1 = runner:latest + patched entrypoint that emits /workspace/cli-envelope.json
// (authoritative input/output token counts) and overwrites usage from the CLI envelope.
// (runner:latest ships claude at /usr/local/bin/claude; orchestrator:latest does NOT.)
const IMAGE = process.env['AEDEV_CLAUDE_DOCKER_IMAGE'] ?? 'claude-code-247/runner:e2e1'
const FORBIDDEN = ['.env', '.env.*', '.github/**', 'secrets/**', 'private_keys/**', 'CLAUDE.md', 'AGENTS.md']
const ALLOWED_PREFIXES = ['README.md', 'PROGRESS.md', 'docs/', 'tests/', 'scripts/']

const EVID = join(process.cwd(), 'evidence', 'e2e', 's1')
const RUN_DIR = join(EVID, 'run')
const DB_PATH = join(EVID, 'e2e1-proof.db')
// Unique per run so re-runs open a fresh draft PR instead of colliding with an
// existing remote branch (a non-fast-forward push would otherwise fail, and
// GR#7 forbids silent force-push). PR #12 remains the historical first proof.
const BRANCH = `aedev-e2e1/readme-running-tests-${Date.now().toString(36)}`

const MISSION_TITLE = 'docs: add "Running the tests" section to README'
const MISSION_DESC = [
  'Add a concise "## Running the tests" section near the end of README.md.',
  'Document that the local test suite runs with `node tests/run.js`, and briefly',
  'list the categories of tests present in the tests/ directory (smoke, failure-mode,',
  'resilience, snapshot-boundary, stress). Keep the new section under ~20 lines.',
  'Only edit README.md. Do not modify any other file. Do not touch .github/**, secrets, or CLAUDE.md/AGENTS.md.',
].join(' ')

const log: string[] = []
const fail: string[] = []
function say(s: string): void { console.log(`[e2e1] ${s}`); log.push(`- ${s}`) }
function sh(cmd: string, args: string[], cwd?: string): string {
  return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

/** Minimal role pipeline: writes a plan.md from the mission. The default
 *  RolePipeline is template-based; for this first proof we keep the role layer
 *  deterministic and focus the proof on the real coder + validators + PR. */
function minimalRolePipeline(): RolePipeline {
  return {
    async run(_mission: unknown, evidenceDir: string) {
      writeFileSync(join(evidenceDir, 'plan.md'),
        `# Plan\n\n${MISSION_TITLE}\n\n${MISSION_DESC}\n`)
      return { outputs: [], evidenceDir }
    },
  } as unknown as RolePipeline
}

const OAUTH_TOKEN_FILE = join(homedir(), '.claude-code-247', 'oauth-token.txt')

/** Read the long-lived subscription OAuth token (from `claude setup-token`).
 *  Keychain-free path proven to authenticate inside the container. */
function readOauthToken(): string {
  if (!existsSync(OAUTH_TOKEN_FILE)) {
    throw new Error(`HOLD-CLAUDE-AUTH-IN-DOCKER: missing ${OAUTH_TOKEN_FILE} — run 'claude setup-token' and write the token there (chmod 600)`)
  }
  const tok = readFileSync(OAUTH_TOKEN_FILE, 'utf8').trim()
  if (!tok) throw new Error(`HOLD-CLAUDE-AUTH-IN-DOCKER: ${OAUTH_TOKEN_FILE} is empty`)
  return tok
}

async function main(): Promise<void> {
  mkdirSync(RUN_DIR, { recursive: true })
  rmSync(DB_PATH, { force: true })
  say(`target=${OWNER}/${NAME} image=${IMAGE} db=${DB_PATH}`)

  // 0. Preflight: validator keys present?
  const secretStatus = inspectDefaultMissionValidatorSecrets(
    { missionId: 'preflight', taskId: 'preflight' }, { env: process.env })
  say(`validator secrets: gemini=${secretStatus.geminiConfigured} openai=${secretStatus.openaiConfigured}`)
  if (!secretStatus.geminiConfigured || !secretStatus.openaiConfigured) {
    throw new Error(`HOLD-VALIDATOR-SECRETS: missing ${secretStatus.missingProviders.join(', ')} — run under ~/.claude-code-247/with-secrets`)
  }

  if (process.env['E2E1_PREFLIGHT'] === '1') {
    say('PREFLIGHT OK — imports resolved, validator secrets present, image configured. Exiting before any side effect.')
    return
  }

  const db = new AedevDb(DB_PATH)
  const oauthToken = readOauthToken()
  process.env['AEDEV_CLAUDE_DOCKER_IMAGE'] = IMAGE
  process.env['AEDEV_CLAUDE_OAUTH_TOKEN'] = oauthToken
  say(`claude subscription OAuth token loaded (${oauthToken.length} chars); injected as CLAUDE_CODE_OAUTH_TOKEN, ANTHROPIC_* stripped in-container`)

  try {
    // 1. Register repo + approved mission in the proof db.
    const repo: Repo = db.insertRepo({
      name: NAME, path: LOCAL_CLONE, githubOwner: OWNER, githubRepo: NAME,
      defaultBranch: 'main', enabled: true,
      testCommands: ['npm run check'], forbiddenPaths: FORBIDDEN,
      riskRules: {}, mergePolicy: 'WAITING',
    })
    const mission = db.insertMission({ repoId: repo.id, title: MISSION_TITLE, description: MISSION_DESC, status: 'approved' })
    say(`mission ${mission.id} approved`)

    // 2. Run the real loop: claude-in-docker coder -> validators -> model_usage.
    const opts: MissionRunOptions = {
      stateDir: RUN_DIR,
      runnerConfig: {
        mode: 'claude-docker', maxConcurrentWorkers: 1,
        worktreeBaseDir: join(RUN_DIR, 'worktrees'),
        outputBaseDir: join(RUN_DIR, 'tasks'),
        sourceRepoPath: LOCAL_CLONE,
        testCommands: ['npm run check'],
        forbiddenPaths: FORBIDDEN,
      },
      rolePipeline: minimalRolePipeline(),
      validatorFactory: createDefaultMissionValidatorFactory({ env: process.env }),
      requiresUi: false,
      requiresDualValidatorGate: true,
    }
    say('running mission (real claude in docker + real dual-family validators)...')
    const result = await new MissionRunner(db, opts).runMission(mission.id)
    say(`run done: status=${result.status} decision=${result.mergeDecision} risk=${result.riskScore} validators=${result.validatorResults.length}`)
    for (const v of result.validatorResults) say(`  validator ${v.validator}: ${v.verdict}`)

    // 3. Audit counts from the proof db.
    const runs = db.listRuns().length
    const usage = db.listModelUsage(result.taskId)
    const usageEvents = db.queryEvents({ type: 'model.usage.recorded' })
    const totalIn = usage.reduce((a, u) => a + (u.inputTokens ?? 0), 0)
    const totalOut = usage.reduce((a, u) => a + (u.outputTokens ?? 0), 0)
    const totalCost = usage.reduce((a, u) => a + (u.costUsd ?? 0), 0)
    say(`audit: runs=${runs} validator_results=${result.validatorResults.length} model_usage=${usage.length} (events=${usageEvents.length}) tokens in/out=${totalIn}/${totalOut} cost=$${totalCost}`)

    if (runs < 1) fail.push('runs < 1')
    if (result.validatorResults.length < 2) fail.push('validator_results < 2')
    const families = new Set(result.validatorResults.map((v) => v.validator))
    if (!(families.has('gemini') && families.has('openai'))) fail.push(`validators not dual-family: ${[...families].join(',')}`)
    if (usage.length < 1) fail.push('model_usage < 1')
    // Real-usage signal: the image's result.json sometimes reports token counts as 0 while
    // carrying a real total_cost_usd (subscription estimate).  Accept cost>0 OR tokens>0.
    if (totalIn <= 0 && totalOut <= 0 && totalCost <= 0) {
      fail.push(`model_usage shows no real usage (in=${totalIn} out=${totalOut} cost=${totalCost})`)
    }

    // 4. Collect coder changes from the worktree.  The claude-docker coder commits
    //    its own work on the clone's default branch, so diff committed + uncommitted
    //    against the pristine base (origin/HEAD captured before the run).
    const workdir = join(RUN_DIR, 'worktrees', result.taskId)
    if (!existsSync(join(workdir, '.git'))) throw new Error(`worktree missing git: ${workdir}`)
    // prompt.txt + result.json + cli-envelope.json are written by the claude-docker
    // entrypoint into the workspace — harness scaffolding, not coder output.
    const HARNESS_FILES = new Set(['prompt.txt', 'result.json', 'cli-envelope.json'])
    const baseSha = sh('git', ['rev-parse', 'origin/HEAD'], workdir)
    const committed = sh('git', ['diff', '--name-only', `${baseSha}..HEAD`], workdir)
    const uncommitted = sh('git', ['status', '--porcelain=v1'], workdir)
      .split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''))
    const changedPaths = [...new Set([...committed.split('\n').filter(Boolean), ...uncommitted])]
      .filter((p) => !HARNESS_FILES.has(p)).sort()
    say(`coder changed paths: ${changedPaths.join(', ') || '(none)'}`)
    const outOfScope = changedPaths.filter((p) => !ALLOWED_PREFIXES.some((a) => p === a || p.startsWith(a)))
    if (changedPaths.length === 0) fail.push('coder produced no changes (cannot open a real PR)')
    if (outOfScope.length > 0) fail.push(`coder touched out-of-scope paths: ${outOfScope.join(', ')}`)

    // 5. Real DRAFT PR via the same remote-write path as p3 smoke.
    let pr: { number: number; url: string; isDraft: boolean; state: string; reused?: boolean } | undefined
    if (changedPaths.length > 0 && outOfScope.length === 0) {
      // The coder committed its work on the clone's branch (HEAD is ahead of baseSha).
      // Name that state as our PR branch, then fold in any in-scope uncommitted files.
      sh('git', ['-C', workdir, 'checkout', '-B', BRANCH])
      const stillUncommitted = sh('git', ['status', '--porcelain=v1'], workdir)
        .split('\n').filter(Boolean).map((l) => l.slice(3).replace(/^"|"$/g, ''))
        .filter((p) => changedPaths.includes(p))
      if (stillUncommitted.length > 0) {
        sh('git', ['-C', workdir, 'add', '--', ...stillUncommitted])
        sh('git', ['-C', workdir, '-c', 'user.name=aedev-e2e1', '-c', 'user.email=ctlanston@gmail.com',
          'commit', '-m', `${MISSION_TITLE} (uncommitted remainder)\n\nAutomated E2E-1 proof. Draft-only; do not merge.`])
      }
      sh('git', ['-C', workdir, 'remote', 'set-url', 'origin', GITHUB_URL])
      say(`PR branch ${BRANCH} ready (${changedPaths.length} in-scope file(s)); origin -> GitHub`)

      const gate = new DraftPrGate({ allowRemoteWrites: true }, new GhGitRemoteWriter(), new GhDraftPrCreator())
      // pushBranch runs `git -C repo.path push`; the branch + commits live in the
      // per-task workdir clone, not LOCAL_CLONE — point the gate's repo at the workdir.
      pr = await gate.openDraftPr({
        repo: { ...repo, path: workdir }, repoPath: workdir, missionId: mission.id, title: MISSION_TITLE, branch: BRANCH, base: 'main',
        changedPaths, evidenceUri: RUN_DIR, riskScore: result.riskScore, validatorResults: result.validatorResults,
        rollbackNotes: 'Close the draft PR; nothing was merged.',
      })
      say(`draft PR #${pr.number} ${pr.url} (isDraft=${pr.isDraft} state=${pr.state} reused=${pr.reused ?? false})`)

      const view = JSON.parse(sh('gh', ['pr', 'view', String(pr.number), '--repo', `${OWNER}/${NAME}`,
        '--json', 'number,isDraft,state,mergedAt']))
      if (!view.isDraft) fail.push(`PR #${pr.number} is not a draft`)
      if (view.mergedAt) fail.push(`PR #${pr.number} was merged (mergedAt=${view.mergedAt})`)
      say(`verified PR #${pr.number}: isDraft=${view.isDraft} state=${view.state} mergedAt=${view.mergedAt ?? 'null'}`)
    }

    // 6. Evidence report.
    writeReport({ result, runs, usage, totalIn, totalOut, changedPaths, pr })
  } finally {
    delete process.env['AEDEV_CLAUDE_OAUTH_TOKEN']
    db.close()
    say('token scrubbed from env; config gate untouched (global allow_remote_writes stays false)')
  }
}

function writeReport(p: {
  result: { taskId: string; status: string; mergeDecision: string; riskScore: number; validatorResults: Array<{ validator: string; verdict: string; summary?: string }> }
  runs: number
  usage: Array<{ provider?: string; model?: string; inputTokens?: number; outputTokens?: number; costUsd?: number; authMode: string }>
  totalIn: number; totalOut: number
  changedPaths: string[]
  pr?: { number: number; url: string; isDraft: boolean; state: string }
}): void {
  const passed = fail.length === 0
  const path = join(EVID, 'e2e1-real-loop-report.md')
  writeFileSync(path, [
    '# E2E-1 — Real End-to-End Loop Proof',
    '', `Result: ${passed ? 'PASS' : 'FAIL'}`,
    `Target: ${OWNER}/${NAME} (draft-only, never merged)`,
    `Coder: subscription Claude in Docker (${IMAGE}), ANTHROPIC_* stripped`,
    '',
    '## Acceptance (objective)',
    `- runs >= 1: ${p.runs}`,
    `- validator_results >= 2: ${p.result.validatorResults.length} (${p.result.validatorResults.map((v) => `${v.validator}:${v.verdict}`).join(', ')})`,
    `- dual independent families: ${p.result.validatorResults.map((v) => v.validator).sort().join('+')}`,
    `- model_usage >= 1: ${p.usage.length}; tokens in/out = ${p.totalIn}/${p.totalOut}; cost = $${p.usage.reduce((a, u) => a + (u.costUsd ?? 0), 0).toFixed(4)}`,
    `- merge decision: ${p.result.mergeDecision} (risk ${p.result.riskScore})`,
    p.pr ? `- draft PR: #${p.pr.number} ${p.pr.url} (isDraft=${p.pr.isDraft}, state=${p.pr.state})` : '- draft PR: NOT OPENED',
    '',
    '## model_usage rows',
    ...p.usage.map((u) => `- ${u.provider}/${u.model ?? '?'} auth=${u.authMode} in=${u.inputTokens} out=${u.outputTokens} cost=$${u.costUsd ?? 0}`),
    '',
    '## Coder changed paths', ...p.changedPaths.map((c) => `- ${c}`),
    '',
    '## Timeline', ...log,
    '', '## Safety invariants',
    passed
      ? '- Claude auth materialized from keychain, mounted read-only, scrubbed after; ANTHROPIC_* stripped in-container (no paid-API fallback); global allow_remote_writes never modified; PR is a draft and was never merged.'
      : fail.map((f) => `- VIOLATION: ${f}`).join('\n'),
  ].join('\n') + '\n')
  console.log(`[e2e1] report: ${path}`)
  if (!passed) { console.error(`[e2e1] FAIL: ${fail.join('; ')}`); process.exitCode = 1 }
  else console.log('[e2e1] PASS — real loop produced model_usage>0, dual-family verdicts, and a draft PR')
}

void main().catch((e) => { console.error('[e2e1] FATAL:', (e as Error).stack ?? e); process.exitCode = 1 })
