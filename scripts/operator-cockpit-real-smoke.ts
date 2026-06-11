/**
 * Real (non-mock) Operator Cockpit smoke — CloudHull semantics.
 *
 * Drives the cockpit through the LIVE local planner + worker path (no
 * AEDEV_COCKPIT_FORCE_MOCK / FORCE_TEMPLATE). Safety-first:
 *   - remote writes stay OFF (AEDEV_ALLOW_REMOTE_WRITES=0),
 *   - the daemon process chdirs into an isolated temp git repo, so the planner
 *     (which runs the local CLI with bypassPermissions in cwd) cannot touch the
 *     real repository,
 *   - the worker executes in a repo-bound isolated git worktree of the mission
 *     repo (never an empty scratch dir) and never pushes.
 *
 * PASS/FAIL semantics (pure + unit-tested in @aedev/daemon real-smoke-policy):
 *   - STRICT (default): PASS requires planner=claude-cli/local_claude_code AND
 *     coder=codex-cli/local_codex. A planner that ran via the honest
 *     AEDEV_PLANNER_FALLBACK=codex path FAILS strict mode
 *     (PLANNER_FALLBACK_NOT_ACCEPTED).
 *   - FALLBACK-PROOF: AEDEV_COCKPIT_REAL_SMOKE_ACCEPT_PLANNER_FALLBACK=1
 *     accepts planner=codex-cli (fallback); the run is then labelled
 *     `DEGRADED (planner fallback)` — never a strict PASS. The report records
 *     both the requested and the achieved mode.
 *   - Gemini must reach a TERMINAL state (pass / fail / not_configured) within
 *     AEDEV_COCKPIT_REAL_SMOKE_VALIDATOR_TIMEOUT_MS (default 180000), else the
 *     run fails with GEMINI_TIMEOUT. validator-summary.json is always written.
 *   - Regression evidence is required: the evidence bundle must show >=1
 *     executed test command with PASS, else REGRESSION_EVIDENCE_MISSING (the
 *     sandbox fixture ships a real `npm test` node assertion target).
 *
 * An evidence report is written to evidence/launch/.
 */
import { execFileSync } from 'child_process'
import { cpSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import {
  createServer,
  buildProviderObservation,
  evaluateProviderPolicy,
  expectedPrBlockCode,
  finalResultLabel,
  parseRegressionEvidence,
  resolveRealSmokeMode,
  resolveValidatorTerminal,
  validatorFailure,
  DEFAULT_VALIDATOR_TIMEOUT_MS,
  VALIDATOR_TIMEOUT_ENV,
  type ModeVerdict,
  type ValidatorOutcome,
} from '@aedev/daemon'

const REPO_ROOT = process.cwd()
const OUT_DIR = join(REPO_ROOT, 'evidence/launch')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const PORT = Number(process.env['AEDEV_COCKPIT_REAL_SMOKE_PORT'] ?? '7277')
const BRAINSTORM_TIMEOUT_MS = Number(process.env['AEDEV_COCKPIT_REAL_SMOKE_BRAINSTORM_MS'] ?? '180000')
const WORKER_TIMEOUT_MS = Number(process.env['AEDEV_COCKPIT_REAL_SMOKE_WORKER_MS'] ?? '300000')
const VALIDATOR_TIMEOUT_MS = Number(process.env[VALIDATOR_TIMEOUT_ENV] ?? String(DEFAULT_VALIDATOR_TIMEOUT_MS))
const REQUIRE_GEMINI_PASS = /^(1|true|yes)$/i.test(process.env['AEDEV_COCKPIT_REAL_SMOKE_REQUIRE_GEMINI'] ?? '')
const MODE = resolveRealSmokeMode(process.env)

// Live path: do NOT force mock/template. Keep remote writes off.
process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
delete process.env['AEDEV_COCKPIT_FORCE_MOCK']
delete process.env['AEDEV_COCKPIT_FORCE_TEMPLATE']
delete process.env['AEDEV_COCKPIT_FAKE_PR']
delete process.env['AEDEV_COCKPIT_FAKE_VALIDATORS']
process.env['AEDEV_COCKPIT_FORCE_REAL'] = '1'
process.env['AEDEV_COCKPIT_SKIP_SESSION_PROBE'] = process.env['AEDEV_COCKPIT_SKIP_SESSION_PROBE'] ?? '1'

const base = `http://127.0.0.1:${PORT}`
const stateDir = mkdtempSync(join(tmpdir(), 'aedev-real-smoke-state-'))
const sandboxRepo = mkdtempSync(join(tmpdir(), 'aedev-real-smoke-repo-'))
const db = new AedevDb(':memory:')
const report: string[] = []
const failures: string[] = []
let server: ReturnType<typeof createServer> | undefined
let modeVerdict: ModeVerdict | null = null
let validatorOutcome: ValidatorOutcome | null = null

void main().catch((e) => {
  console.error(e)
  failures.push(`fatal: ${(e as Error).message}`)
}).finally(finish)

async function main(): Promise<void> {
  log(`requested mode: ${MODE} (strict requires planner=claude-cli + coder=codex-cli; fallback-proof accepts planner=codex-cli (fallback) as DEGRADED)`)

  // Isolated git repo so the live planner runs against scratch, never the real
  // tree. It must have a commit (the worker runs in a `git worktree add` of
  // HEAD) and a REAL test target: package.json with a tiny `npm test` node
  // assertion script, so the worker has a verifiable regression command (c3).
  buildSandboxFixture(sandboxRepo)
  process.chdir(sandboxRepo)

  const repo = db.insertRepo({
    name: 'real-smoke',
    path: sandboxRepo,
    defaultBranch: 'main',
    enabled: true,
    testCommands: ['npm test'],
    forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    riskRules: {},
    mergePolicy: 'WAITING',
  })

  server = createServer(db, new Date(), stateDir)
  await server.listen({ port: PORT, host: '127.0.0.1' })
  log(`daemon up on ${base}; sandbox repo ${sandboxRepo}`)

  const prompt = 'Planning only: propose a single low-risk one-line clarification to add to README.md. '
    + 'Keep the roadmap to one coder task that makes the README change, then runs the repository test command '
    + '(`npm test`) and records the exact command with its pass/fail result in the report. Do not modify other code.'
  const created = await postJson('/operator/sessions', { repoId: repo.id, title: 'Real cockpit smoke', prompt })
  const sessionId = (created as { session: { id: string } }).session.id
  log(`session ${sessionId} created; waiting for live brainstorm…`)

  const brainstorm = await driveClarificationToReady(sessionId, BRAINSTORM_TIMEOUT_MS)
  log(`brainstorm status: ${brainstorm ?? 'TIMEOUT'}`)
  if (brainstorm !== 'brainstorm_ready') {
    failures.push(`planner did not reach 95% understanding (status=${brainstorm ?? 'timeout'}); no execution evidence exists`)
    modeVerdict = evaluateProviderPolicy(MODE, buildProviderObservation([]))
    return
  }

  const roadmap = await postJson(`/operator/sessions/${sessionId}/generate-roadmap`, {}) as {
    mission?: { id: string }
    hold?: { code: string; reason: string }
  }
  let missionId: string | undefined
  if (roadmap.hold) {
    log(`roadmap HOLD: ${roadmap.hold.code} — ${roadmap.hold.reason}`)
    failures.push(`roadmap HOLD ${roadmap.hold.code}: ${roadmap.hold.reason}`)
  } else if (roadmap.mission) {
    missionId = roadmap.mission.id
    log(`roadmap generated for mission ${missionId} (live planner JSON parsed)`)
    await postJson(`/operator/sessions/${sessionId}/approve-roadmap`, {})
    log('roadmap approved; starting live worker…')
    await postJson(`/operator/sessions/${sessionId}/start`, {})
    const terminal = await pollMission(missionId, WORKER_TIMEOUT_MS)
    log(`worker terminal state: ${terminal ?? 'TIMEOUT'}`)
    if (!terminal) failures.push(`WORKER_TIMEOUT: worker did not reach a terminal state within ${WORKER_TIMEOUT_MS}ms`)

    // --- c2: poll the overview until the validator reaches a TERMINAL state.
    if (terminal) {
      const v = await awaitValidatorTerminal(missionId, VALIDATOR_TIMEOUT_MS)
      validatorOutcome = v.outcome
      log(`validator terminal: ${v.outcome} after ${v.waitedMs}ms (verdicts: ${v.validators.map((x) => `${x.validator}=${x.verdict}`).join(', ') || 'none'})`)
      const vFail = validatorFailure(v.outcome, { requireGeminiPass: REQUIRE_GEMINI_PASS, timeoutMs: VALIDATOR_TIMEOUT_MS })
      if (vFail) {
        failures.push(vFail)
        log(vFail)
      }
      writeValidatorSummary(missionId, v)
    }
  }

  // --- Gates + invariants (these decide PASS / DEGRADED / FAIL) ---
  if (missionId) {
    const expectedBlock = expectedPrBlockCode(validatorOutcome)
    const prRes = await fetch(`${base}/operator/sessions/${sessionId}/create-pr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const pr = await prRes.json() as { status?: string; code?: string; error?: string }
    log(`create-pr → HTTP ${prRes.status} status=${pr.status ?? '(none)'} code=${pr.code ?? pr.error ?? '(none)'} (expected block: ${expectedBlock ?? 'any'})`)
    if (prRes.status !== 200) {
      failures.push(`create-pr returned HTTP ${prRes.status}: ${pr.error ?? JSON.stringify(pr)}`)
    } else {
      if (pr.status !== 'blocked') failures.push(`draft PR was not blocked (status=${pr.status})`)
      if (expectedBlock && pr.code !== expectedBlock) failures.push(`unexpected block code: ${pr.code}; expected ${expectedBlock}`)
    }

    const overview = await getJson(`/missions/${missionId}/overview`) as {
      mission: { githubPrUrl?: string }
      validatorStatus?: string
      validators: Array<{ validator: string; verdict: string }>
      evidenceDir?: string
      runs?: Array<{ runnerMode: string; status: string }>
      events: Array<{ type: string; entityType?: string; payload: Record<string, unknown> }>
    }
    if (overview.mission.githubPrUrl) failures.push(`a PR URL was created with remote writes off: ${overview.mission.githubPrUrl}`)
    if (overview.validators.length === 0 && overview.validatorStatus !== 'not_configured') {
      failures.push(`no validators ran but status was '${overview.validatorStatus}' (expected not_configured)`)
    }
    summarizeProviders(overview.events)
    log(`validatorStatus=${overview.validatorStatus}; evidenceDir=${overview.evidenceDir ?? '(none)'}`)

    // --- c1: provider policy (strict vs fallback-proof), pure + unit-tested.
    const observation = buildProviderObservation(overview.events, {
      latestRunMode: overview.runs?.[0]?.runnerMode,
      workerUsageProvider: readWorkerUsageString(overview.evidenceDir, 'provider'),
      workerUsageAuthMode: readWorkerUsageString(overview.evidenceDir, 'authMode'),
    })
    log(`provider evidence: planner=${observation.plannerProviders.join(', ') || '(none)'}${observation.plannerFallbackObserved ? ' [FALLBACK]' : ''} auth=${observation.plannerAuthModes.join(', ') || '(none)'}`)
    log(`provider evidence: coder=${observation.workerProviders.join(', ') || '(none)'} auth=${observation.workerAuthModes.join(', ') || '(none)'}`)
    modeVerdict = evaluateProviderPolicy(MODE, observation)
    log(`mode verdict: requested=${modeVerdict.requestedMode} achieved=${modeVerdict.achievedMode} → ${modeVerdict.resultLabel}`)
    failures.push(...modeVerdict.failures)

    // --- c3: required regression evidence (>=1 executed test command, PASS).
    const evidenceTexts = readEvidenceTexts(overview.evidenceDir)
    const regression = parseRegressionEvidence(evidenceTexts)
    if (regression.ok) {
      log(`regression evidence: ${regression.commands.filter((c) => c.passed).map((c) => `\`${c.command}\` PASS [${c.source}]`).join('; ')}`)
    } else {
      log(regression.reason ?? 'regression evidence missing')
      failures.push(regression.reason ?? 'REGRESSION_EVIDENCE_MISSING')
    }

    // Repo-bound worker invariant (the P0 trust fix): if a worker ran, it MUST
    // have executed inside a git worktree of the registered mission repo —
    // never a scratch dir.
    const ready = overview.events.find((e) => e.type === 'operator.repo_bound_workspace_ready')
    if (ready) {
      const repoPath = String(ready.payload['repoPath'] ?? '')
      const worktreePath = String(ready.payload['worktreePath'] ?? '')
      log(`repo-bound workspace: repoPath=${repoPath} worktreePath=${worktreePath} dirty=${String(ready.payload['dirtyStatus'] ?? '?')}`)
      if (repoPath !== sandboxRepo) failures.push(`worker repoPath ${repoPath} != registered fixture repo ${sandboxRepo}`)
      if (!worktreePath.includes('operator-workspaces')) failures.push(`worker worktree ${worktreePath} is not an isolated repo-bound workspace`)
      const changedPathsFile = overview.evidenceDir ? join(overview.evidenceDir, 'changed-paths.json') : ''
      if (changedPathsFile && existsSync(changedPathsFile)) {
        const cp = JSON.parse(readFileSync(changedPathsFile, 'utf8')) as { repoPath?: string; changedPaths?: string[] }
        if (cp.repoPath && cp.repoPath !== sandboxRepo) failures.push(`evidence changed-paths repoPath ${cp.repoPath} != fixture repo`)
        log(`worker changed ${cp.changedPaths?.length ?? 0} repo file(s): ${(cp.changedPaths ?? []).join(', ') || '(none)'}`)
      }
    } else {
      log('Repo-bound workspace event was not present in the overview window; repo-binding invariant not exercised from events.')
    }
    if (overview.evidenceDir && existsSync(overview.evidenceDir)) {
      log(`evidence files: ${readdirSync(overview.evidenceDir).join(', ')}`)
      // Persist a durable copy before the temp state dir is cleaned up.
      const durable = join(OUT_DIR, `operator-cockpit-real-smoke-${STAMP}-evidence`)
      mkdirSync(OUT_DIR, { recursive: true })
      cpSync(overview.evidenceDir, durable, { recursive: true })
      log(`durable evidence copied to ${durable}`)
    }
  } else {
    log('No mission reached execution (planner HOLD). The run cannot PASS without execution evidence.')
    modeVerdict = modeVerdict ?? evaluateProviderPolicy(MODE, buildProviderObservation([]))
    failures.push(...modeVerdict.failures)
  }
}

/** c3 fixture: disposable git repo with a REAL verifiable test target. */
function buildSandboxFixture(dir: string): void {
  execFileSync('git', ['init', '-q'], { cwd: dir })
  execFileSync('git', ['config', 'user.email', 'real-smoke@example.invalid'], { cwd: dir })
  execFileSync('git', ['config', 'user.name', 'real-smoke'], { cwd: dir })
  // Disposable fixture commits must not depend on the host's signing setup.
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir })
  writeFileSync(join(dir, 'README.md'), '# Sandbox\n\nDisposable repo for the Operator Cockpit real smoke.\n\nRun `npm test` for the regression check.\n')
  writeFileSync(join(dir, 'package.json'), JSON.stringify({
    name: 'real-smoke-fixture',
    version: '0.0.0',
    private: true,
    scripts: { test: 'node test/run-tests.cjs' },
  }, null, 2) + '\n')
  mkdirSync(join(dir, 'test'), { recursive: true })
  writeFileSync(join(dir, 'test', 'run-tests.cjs'), [
    "const assert = require('node:assert')",
    'assert.strictEqual(1 + 1, 2)',
    "assert.ok(require('node:fs').existsSync(require('node:path').join(__dirname, '..', 'README.md')), 'README.md must exist')",
    "console.log('fixture regression: 2 passed, 0 failed')",
    '',
  ].join('\n'))
  execFileSync('git', ['add', '.'], { cwd: dir })
  execFileSync('git', ['commit', '-q', '-m', 'initial fixture commit (real npm test target)'], { cwd: dir })
}

function readEvidenceTexts(evidenceDir?: string): Record<string, string> {
  if (!evidenceDir || !existsSync(evidenceDir)) return {}
  const out: Record<string, string> = {}
  for (const name of readdirSync(evidenceDir)) {
    if (!/\.(md|log|txt|json)$/i.test(name)) continue
    try {
      const path = join(evidenceDir, name)
      const stat = statSync(path)
      if (stat.isFile() && stat.size <= 4 * 1024 * 1024) out[name] = readFileSync(path, 'utf8')
    } catch { /* unreadable file: skip, parser reports honestly on what it saw */ }
  }
  return out
}

function summarizeProviders(events: Array<{ type: string; payload: Record<string, unknown> }>): void {
  const providers = new Set<string>()
  for (const e of events) {
    if ((e.type === 'operator.role_done' || e.type === 'operator.worker_started' || e.type === 'operator.cost_updated') && typeof e.payload['provider'] === 'string') {
      providers.add(e.payload['provider'] as string)
    }
  }
  log(`live providers observed: ${[...providers].filter((p) => p && p !== 'null').join(', ') || '(none recorded)'}`)
}

/** c2: durable validator-summary.json — verdicts array + terminal status. */
function writeValidatorSummary(missionId: string, v: {
  outcome: ValidatorOutcome
  validators: Array<{ validator: string; verdict: string; summary?: string | null }>
  validatorStatus?: string | undefined
  waitedMs: number
  evidenceDir?: string | undefined
}): void {
  const summary = JSON.stringify({
    missionId,
    terminal: v.outcome,
    validatorStatus: v.validatorStatus ?? null,
    verdicts: v.validators.map((x) => ({ validator: x.validator, verdict: x.verdict, ...(x.summary ? { summary: x.summary } : {}) })),
    waitedMs: v.waitedMs,
    timeoutMs: VALIDATOR_TIMEOUT_MS,
    at: new Date().toISOString(),
  }, null, 2)
  mkdirSync(OUT_DIR, { recursive: true })
  const durable = join(OUT_DIR, `operator-cockpit-real-smoke-${STAMP}-validator-summary.json`)
  writeFileSync(durable, summary)
  if (v.evidenceDir && existsSync(v.evidenceDir)) {
    writeFileSync(join(v.evidenceDir, 'validator-summary.json'), summary)
  }
  log(`validator-summary.json written (terminal=${v.outcome}) → ${durable}`)
}

function readWorkerUsageString(evidenceDir: string | undefined, key: string): string | undefined {
  if (!evidenceDir) return undefined
  const path = join(evidenceDir, 'model-usage.json')
  if (!existsSync(path)) return undefined
  try {
    const usage = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    return typeof usage[key] === 'string' ? usage[key] as string : undefined
  } catch {
    return undefined
  }
}

async function driveClarificationToReady(id: string, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  const answered = new Set<string>()
  while (Date.now() < deadline) {
    const { session, messages } = await getJson(`/operator/sessions/${id}`) as {
      session: { status: string }
      messages: Array<{ role: string; questions?: Array<{ id: string; field?: string; question?: string; options?: Array<{ label: string; recommended?: boolean; value?: string }> }> }>
    }
    if (session.status === 'brainstorm_ready' || session.status === 'hold') return session.status
    if (session.status === 'clarifying') {
      const questions = [...messages].reverse().find((m) => m.role === 'assistant' && m.questions?.length)?.questions ?? []
      const unanswered = questions.filter((q) => !answered.has(q.id))
      if (unanswered.length) {
        await postJson(`/operator/sessions/${id}/answer-questions`, {
          answers: unanswered.map((q) => {
            answered.add(q.id)
            return { questionId: q.id, value: answerForQuestion(q) }
          }),
        })
        log(`answered ${unanswered.length} clarification question(s)`)
        await postJson(`/operator/sessions/${id}/ask`, { prompt: 'Re-check confidence after my answers. If confidence is at least 95 and nothing is pending, return no more questions.' })
      }
    }
    await sleep(2000)
  }
  return undefined
}

function answerForQuestion(q: { field?: string; question?: string }): string {
  const text = `${q.field ?? ''}\n${q.question ?? ''}`.toLowerCase()
  if (/target|file|where|which.*repo|readme/.test(text)) return 'Target: README.md only, in the repo registered for this smoke run.'
  if (/scope|how much|boundary|allowed|touch|change/.test(text)) return 'Scope: smallest viable README-only change; do not touch package files, source code, tests, .env, secrets, .github, AGENTS.md, or remote branches. Running the existing test command is allowed and required.'
  if (/accept|success|criteria|pass|verify|test/.test(text)) return 'Acceptance: README.md gains exactly one short note, changed-paths.json lists only README.md, the coder runs `npm test` and records the exact command with its pass/fail result and exit code in the Tests/checks section, and the worker writes plan.md, diff-summary.md, test-summary.md, and done-report.md evidence.'
  if (/done|evidence|finish|complete|definition/.test(text)) return 'Done: evidence files exist including the recorded `npm test` PASS, Gemini validates the evidence bundle with PASS, and Draft PR creation remains blocked by remote writes being disabled.'
  if (/content|note|write|wording|message/.test(text)) return 'Content: add one sentence saying this sandbox validates the gated cockpit flow; keep it short and non-promotional.'
  if (/risk|rollback|safety|remote|pr|push/.test(text)) return 'Safety: no remote writes, no push, no PR creation unless the safety gate allows it; rollback is deleting the one README sentence in the isolated worktree.'
  return 'Use one README-only change with explicit evidence, an executed `npm test` PASS recorded in the report, Gemini validation, and no remote writes.'
}

async function pollMission(id: string, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const overview = await getJson(`/missions/${id}/overview`) as {
      mission: { status: string }
      validators: Array<{ validator: string; verdict: string }>
      validatorStatus?: string
      events: Array<{ type: string }>
    }
    const status = overview.mission.status
    if (['done', 'failed', 'paused', 'cancelled'].includes(status)) return status
    if (overview.validators.length > 0 && overview.events.some((e) => e.type === 'operator.evidence_written')) return `validated-${overview.validators[0]?.verdict ?? 'unknown'}`
    if (overview.validatorStatus === 'not_configured' && overview.events.some((e) => e.type === 'operator.evidence_written')) return 'validators-not-configured'
    await sleep(3000)
  }
  return undefined
}

/** c2: poll the mission overview until the validator reaches a TERMINAL state
 *  (pass / fail / not_configured), or the validator timeout elapses. */
async function awaitValidatorTerminal(id: string, timeoutMs: number): Promise<{
  outcome: ValidatorOutcome
  validators: Array<{ validator: string; verdict: string; summary?: string | null }>
  validatorStatus?: string | undefined
  waitedMs: number
  evidenceDir?: string | undefined
}> {
  const startedAt = Date.now()
  let last: { validators: Array<{ validator: string; verdict: string; summary?: string | null }>; validatorStatus?: string; evidenceDir?: string } = { validators: [] }
  for (;;) {
    const overview = await getJson(`/missions/${id}/overview`) as {
      validators: Array<{ validator: string; verdict: string; summary?: string | null }>
      validatorStatus?: string
      evidenceDir?: string
    }
    last = overview
    const terminal = resolveValidatorTerminal(overview)
    if (terminal) {
      return { outcome: terminal, validators: overview.validators, validatorStatus: overview.validatorStatus, waitedMs: Date.now() - startedAt, evidenceDir: overview.evidenceDir }
    }
    if (Date.now() - startedAt >= timeoutMs) {
      return { outcome: 'timeout', validators: last.validators, validatorStatus: last.validatorStatus, waitedMs: Date.now() - startedAt, evidenceDir: last.evidenceDir }
    }
    await sleep(3000)
  }
}

async function postJson(path: string, body: unknown): Promise<unknown> {
  const res = await fetch(`${base}${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  if (!res.ok) throw new Error(`POST ${path} → HTTP ${res.status}`)
  return res.json()
}

async function getJson(path: string): Promise<unknown> {
  const res = await fetch(`${base}${path}`)
  if (!res.ok) throw new Error(`GET ${path} → HTTP ${res.status}`)
  return res.json()
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

function log(line: string): void {
  console.log(`[real-smoke] ${line}`)
  report.push(`- ${line}`)
}

function finish(): void {
  const label = finalResultLabel(modeVerdict, failures)
  mkdirSync(OUT_DIR, { recursive: true })
  const reportPath = join(OUT_DIR, `operator-cockpit-real-smoke-${STAMP}.md`)
  writeFileSync(reportPath, [
    '# Operator Cockpit — Real (non-mock) Smoke Evidence',
    '',
    `Date: ${new Date().toISOString()}`,
    `Result: ${label}${label === 'FAIL' ? ' — see violations below' : label === 'DEGRADED (planner fallback)' ? ' — accepted by fallback-proof mode; NOT a strict PASS' : ' — safety invariants + provider policy held'}`,
    `Requested mode: ${MODE}`,
    `Achieved mode: ${modeVerdict ? modeVerdict.achievedMode : '(not reached — no execution evidence)'}`,
    `Validator terminal: ${validatorOutcome ?? '(not reached)'}`,
    '',
    '## Timeline',
    ...report,
    '',
    '## Violations / failures',
    failures.length ? failures.map((f) => `- VIOLATION: ${f}`).join('\n') : '- None: draft PR blocked as expected, no PR URL created, validators not faked, provider policy satisfied, regression evidence present.',
    '',
    '## Notes',
    '- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.',
    '- Planner ran in an isolated temp git repo; worker ran in an isolated repo-bound git worktree.',
    '- STRICT mode fails on planner fallback; fallback-proof mode labels such runs DEGRADED (planner fallback), never a strict PASS.',
    `- Gemini terminal state is awaited up to ${VALIDATOR_TIMEOUT_MS}ms (${VALIDATOR_TIMEOUT_ENV}); a timeout is reported as GEMINI_TIMEOUT, never as vague "pending".`,
    '- Strict success requires >=1 executed test command with PASS in the evidence (REGRESSION_EVIDENCE_MISSING otherwise).',
    `- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-${STAMP}-evidence/.`,
  ].join('\n'))
  console.log(`[real-smoke] evidence report: ${reportPath}`)

  try { void server?.close() } catch { /* ignore */ }
  try { db.close() } catch { /* ignore */ }
  process.chdir(REPO_ROOT)
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(sandboxRepo, { recursive: true, force: true })

  if (label === 'FAIL') {
    console.error(`[real-smoke] FAIL: ${failures.join('; ') || 'no execution evidence'}`)
    process.exitCode = 1
  } else if (label === 'DEGRADED (planner fallback)') {
    console.log('[real-smoke] DEGRADED (planner fallback) — accepted by fallback-proof mode; NOT a strict PASS')
  } else {
    console.log('[real-smoke] PASS (strict) — safety invariants + provider policy held on the live path')
  }
}
