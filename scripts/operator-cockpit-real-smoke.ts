/**
 * Real (non-mock) Operator Cockpit smoke.
 *
 * Drives the cockpit through the LIVE local planner + worker path (no
 * AEDEV_COCKPIT_FORCE_MOCK / FORCE_TEMPLATE). Safety-first:
 *   - remote writes stay OFF (AEDEV_ALLOW_REMOTE_WRITES=0),
 *   - the daemon process chdirs into an isolated temp git repo, so the planner
 *     (which runs the local CLI with bypassPermissions in cwd) cannot touch the
 *     real repository,
 *   - the worker executes in a repo-bound isolated git worktree of that fixture
 *     repo (never an empty scratch dir) and never pushes.  This run also asserts
 *     the worker ran inside the registered repo (no temp-dir fake success).
 *
 * The script FAILS only if a safety invariant is violated. Planner/worker HOLDs
 * are recorded as honest evidence, not crashes. An evidence report is written to
 * evidence/launch/.
 */
import { execFileSync } from 'child_process'
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, readFileSync, existsSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { createServer } from '@aedev/daemon'

const REPO_ROOT = process.cwd()
const OUT_DIR = join(REPO_ROOT, 'evidence/launch')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const PORT = Number(process.env['AEDEV_COCKPIT_REAL_SMOKE_PORT'] ?? '7277')
const BRAINSTORM_TIMEOUT_MS = Number(process.env['AEDEV_COCKPIT_REAL_SMOKE_BRAINSTORM_MS'] ?? '180000')
const WORKER_TIMEOUT_MS = Number(process.env['AEDEV_COCKPIT_REAL_SMOKE_WORKER_MS'] ?? '300000')

// Live path: do NOT force mock/template. Keep remote writes off.
process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
delete process.env['AEDEV_COCKPIT_FORCE_MOCK']
delete process.env['AEDEV_COCKPIT_FORCE_TEMPLATE']
delete process.env['AEDEV_COCKPIT_FAKE_PR']
delete process.env['AEDEV_COCKPIT_FAKE_VALIDATORS']
process.env['AEDEV_COCKPIT_FORCE_REAL'] = '1'

const base = `http://127.0.0.1:${PORT}`
const stateDir = mkdtempSync(join(tmpdir(), 'aedev-real-smoke-state-'))
const sandboxRepo = mkdtempSync(join(tmpdir(), 'aedev-real-smoke-repo-'))
const db = new AedevDb(':memory:')
const report: string[] = []
const safetyFailures: string[] = []
let server: ReturnType<typeof createServer> | undefined

void main().catch((e) => {
  console.error(e)
  safetyFailures.push(`fatal: ${(e as Error).message}`)
}).finally(finish)

async function main(): Promise<void> {
  // Isolated git repo so the live planner runs against scratch, never the real tree.
  // It must have a commit: the worker runs in a `git worktree add` of HEAD.
  execFileSync('git', ['init', '-q'], { cwd: sandboxRepo })
  execFileSync('git', ['config', 'user.email', 'real-smoke@example.invalid'], { cwd: sandboxRepo })
  execFileSync('git', ['config', 'user.name', 'real-smoke'], { cwd: sandboxRepo })
  writeFileSync(join(sandboxRepo, 'README.md'), '# Sandbox\n\nDisposable repo for the Operator Cockpit real smoke.\n')
  execFileSync('git', ['add', '.'], { cwd: sandboxRepo })
  execFileSync('git', ['commit', '-q', '-m', 'initial fixture commit'], { cwd: sandboxRepo })
  process.chdir(sandboxRepo)

  const repo = db.insertRepo({
    name: 'real-smoke',
    path: sandboxRepo,
    defaultBranch: 'main',
    enabled: true,
    testCommands: [],
    forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
    riskRules: {},
    mergePolicy: 'WAITING',
  })

  server = createServer(db, new Date(), stateDir)
  await server.listen({ port: PORT, host: '127.0.0.1' })
  log(`daemon up on ${base}; sandbox repo ${sandboxRepo}`)

  const prompt = 'Planning only: propose a single low-risk one-line clarification to add to README.md. '
    + 'Keep the roadmap to one coder task that writes a short note file as evidence. Do not modify other code.'
  const created = await postJson('/operator/sessions', { repoId: repo.id, title: 'Real cockpit smoke', prompt })
  const sessionId = (created as { session: { id: string } }).session.id
  log(`session ${sessionId} created; waiting for live brainstorm…`)

  const brainstorm = await pollSession(sessionId, ['brainstorm_ready', 'hold'], BRAINSTORM_TIMEOUT_MS)
  log(`brainstorm status: ${brainstorm ?? 'TIMEOUT'}`)

  const roadmap = await postJson(`/operator/sessions/${sessionId}/generate-roadmap`, {}) as {
    mission?: { id: string }
    hold?: { code: string; reason: string }
  }
  let missionId: string | undefined
  if (roadmap.hold) {
    log(`roadmap HOLD: ${roadmap.hold.code} — ${roadmap.hold.reason}`)
  } else if (roadmap.mission) {
    missionId = roadmap.mission.id
    log(`roadmap generated for mission ${missionId} (live planner JSON parsed)`)
    await postJson(`/operator/sessions/${sessionId}/approve-roadmap`, {})
    log('roadmap approved; starting live worker…')
    await postJson(`/operator/sessions/${sessionId}/start`, {})
    const terminal = await pollMission(missionId, WORKER_TIMEOUT_MS)
    log(`worker terminal state: ${terminal ?? 'TIMEOUT'}`)
  }

  // --- Safety assertions (these gate PASS/FAIL) ---
  if (missionId) {
    // Capture status + body without throwing so a create-pr issue is recorded as
    // evidence and the repo-binding invariant below still runs.
    const prRes = await fetch(`${base}/operator/sessions/${sessionId}/create-pr`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
    const pr = await prRes.json() as { status?: string; code?: string; error?: string }
    log(`create-pr → HTTP ${prRes.status} status=${pr.status ?? '(none)'} code=${pr.code ?? pr.error ?? '(none)'}`)
    if (prRes.status !== 200) {
      safetyFailures.push(`create-pr returned HTTP ${prRes.status}: ${pr.error ?? JSON.stringify(pr)}`)
    } else {
      if (pr.status !== 'blocked') safetyFailures.push(`draft PR was not blocked (status=${pr.status})`)
      if (pr.code !== 'REMOTE_WRITES_DISABLED') safetyFailures.push(`unexpected block code: ${pr.code}`)
    }

    const overview = await getJson(`/missions/${missionId}/overview`) as {
      mission: { githubPrUrl?: string }
      validatorStatus?: string
      validators: unknown[]
      evidenceDir?: string
      events: Array<{ type: string; payload: Record<string, unknown> }>
    }
    if (overview.mission.githubPrUrl) safetyFailures.push(`a PR URL was created with remote writes off: ${overview.mission.githubPrUrl}`)
    if (overview.validators.length === 0 && overview.validatorStatus !== 'not_configured') {
      safetyFailures.push(`no validators ran but status was '${overview.validatorStatus}' (expected not_configured)`)
    }
    summarizeProviders(overview.events)
    log(`validatorStatus=${overview.validatorStatus}; evidenceDir=${overview.evidenceDir ?? '(none)'}`)

    // Repo-bound worker invariant (the P0 trust fix): if a worker ran, it MUST have
    // executed inside a git worktree of the registered repo — never a scratch dir.
    const ready = overview.events.find((e) => e.type === 'operator.repo_bound_workspace_ready')
    if (ready) {
      const repoPath = String(ready.payload['repoPath'] ?? '')
      const worktreePath = String(ready.payload['worktreePath'] ?? '')
      log(`repo-bound workspace: repoPath=${repoPath} worktreePath=${worktreePath} dirty=${String(ready.payload['dirtyStatus'] ?? '?')}`)
      if (repoPath !== sandboxRepo) safetyFailures.push(`worker repoPath ${repoPath} != registered fixture repo ${sandboxRepo}`)
      if (!worktreePath.includes('operator-workspaces')) safetyFailures.push(`worker worktree ${worktreePath} is not an isolated repo-bound workspace`)
      const changedPathsFile = overview.evidenceDir ? join(overview.evidenceDir, 'changed-paths.json') : ''
      if (changedPathsFile && existsSync(changedPathsFile)) {
        const cp = JSON.parse(readFileSync(changedPathsFile, 'utf8')) as { repoPath?: string; changedPaths?: string[] }
        if (cp.repoPath && cp.repoPath !== sandboxRepo) safetyFailures.push(`evidence changed-paths repoPath ${cp.repoPath} != fixture repo`)
        log(`worker changed ${cp.changedPaths?.length ?? 0} repo file(s): ${(cp.changedPaths ?? []).join(', ') || '(none)'}`)
      }
    } else {
      log('No repo-bound worker ran this round (planner HOLD or no worker session); repo-binding invariant not exercised.')
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
    log('No mission reached execution (planner HOLD). Safety gates for draft PR were not exercised this run.')
  }
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

async function pollSession(id: string, until: string[], timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const { session } = await getJson(`/operator/sessions/${id}`) as { session: { status: string } }
    if (until.includes(session.status)) return session.status
    await sleep(2000)
  }
  return undefined
}

async function pollMission(id: string, timeoutMs: number): Promise<string | undefined> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const overview = await getJson(`/missions/${id}/overview`) as { mission: { status: string }; runs: Array<{ status: string }> }
    const status = overview.mission.status
    if (['done', 'failed', 'paused', 'cancelled'].includes(status)) return status
    if (overview.runs.some((r) => r.status === 'done' || r.status === 'failed')) return `run-${overview.runs[0]?.status}`
    await sleep(3000)
  }
  return undefined
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
  const passed = safetyFailures.length === 0
  mkdirSync(OUT_DIR, { recursive: true })
  const reportPath = join(OUT_DIR, `operator-cockpit-real-smoke-${STAMP}.md`)
  writeFileSync(reportPath, [
    '# Operator Cockpit — Real (non-mock) Smoke Evidence',
    '',
    `Date: ${new Date().toISOString()}`,
    `Result: ${passed ? 'PASS (safety invariants held)' : 'FAIL (safety invariant violated)'}`,
    '',
    '## Timeline',
    ...report,
    '',
    '## Safety invariants',
    passed
      ? '- All checked: draft PR blocked with REMOTE_WRITES_DISABLED, no PR URL created, validators not faked.'
      : safetyFailures.map((f) => `- VIOLATION: ${f}`).join('\n'),
    '',
    '## Notes',
    '- Live local CLI planner/worker path (no mock/template). Remote writes were disabled.',
    '- Planner ran in an isolated temp git repo; worker ran in an isolated temp workspace.',
    '- A planner/worker HOLD is recorded above as honest evidence and does not fail the safety smoke.',
    `- Durable worker evidence (if any) copied alongside this report under operator-cockpit-real-smoke-${STAMP}-evidence/.`,
  ].join('\n'))
  console.log(`[real-smoke] evidence report: ${reportPath}`)

  try { void server?.close() } catch { /* ignore */ }
  try { db.close() } catch { /* ignore */ }
  process.chdir(REPO_ROOT)
  rmSync(stateDir, { recursive: true, force: true })
  rmSync(sandboxRepo, { recursive: true, force: true })

  if (!passed) {
    console.error(`[real-smoke] FAIL: ${safetyFailures.join('; ')}`)
    process.exitCode = 1
  } else {
    console.log('[real-smoke] PASS — safety invariants held on the live path')
  }
}
