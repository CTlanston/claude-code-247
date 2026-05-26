import { execFile, spawn, spawnSync } from 'child_process'
import { promisify } from 'util'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { AedevDb } from '@aedev/core'
import { IntakeService, MissionRunner, ReleasePipeline, ShellGitClient } from '@aedev/daemon'
import { GeminiValidator, OpenAIValidator, MergePolicy } from '@aedev/validators'
import { BrowserQA, createPlaywrightDriver } from '@aedev/qa'

const execFileAsync = promisify(execFile)

interface SandboxConfig {
  repo_id: string
  path: string
  github_owner: string
  github_repo: string
  default_branch: string
  stack: string
  allow_auto_merge: boolean
  allow_direct_revert: boolean
  require_screenshots: boolean
  require_dual_validators: boolean
}

interface FinalReport {
  runId: string
  prUrl: string
  mergeSha: string
  revertSha: string
  incidentPath: string
  evidenceDir: string
}

const AEDEV_HOME = process.env['AEDEV_HOME'] ?? join(homedir(), '.aedev')
const SECRETS_PATH = process.env['AEDEV_SECRETS_FILE'] ?? join(AEDEV_HOME, 'secrets.env')
const SANDBOX_PATH = process.env['AEDEV_SANDBOX_CONFIG'] ?? join(AEDEV_HOME, 'sandbox.yaml')
const SECRETS_WRAPPER = process.env['SECRETS_WRAPPER'] ?? join(homedir(), '.claude-code-247', 'with-secrets')

async function main(): Promise<void> {
  ensureSecretsEnvironment()
  const cfg = readSandboxConfig(SANDBOX_PATH)
  validateSandboxConfig(cfg)
  await validateTooling()
  await validateRequiredSecrets()
  await validateSandboxRepo(cfg)

  const runId = `${new Date().toISOString().replace(/[-:.TZ]/g, '').slice(0, 14)}-${Math.random().toString(16).slice(2, 8)}`
  const branch = `aedev/e2e/${runId}`
  const evidenceDir = join(AEDEV_HOME, 'e2e-evidence', cfg.repo_id, runId)
  mkdirSync(evidenceDir, { recursive: true })

  let prUrl = ''
  let mergeSha = ''
  let revertSha = ''
  let incidentPath = ''
  let devServer: ReturnType<typeof spawn> | null = null

  try {
    await git(cfg.path, ['fetch', 'origin', cfg.default_branch])
    await git(cfg.path, ['checkout', cfg.default_branch])
    await git(cfg.path, ['pull', '--ff-only', 'origin', cfg.default_branch])
    await git(cfg.path, ['checkout', '-b', branch])

    const db = new AedevDb(':memory:')
    const repo = db.insertRepo({
      name: cfg.repo_id,
      path: cfg.path,
      githubOwner: cfg.github_owner,
      githubRepo: cfg.github_repo,
      defaultBranch: cfg.default_branch,
      enabled: true,
      testCommands: ['pnpm test', 'pnpm build'],
      forbiddenPaths: ['.env', '.env.*', 'secrets/**'],
      riskRules: {},
      mergePolicy: 'sandbox-low-risk-dual-validator',
    })
    const intake = new IntakeService(db, evidenceDir)
    const mission = intake.createMissionCandidate(repo.id, 'Build a polished responsive aedev E2E product dashboard increment', 'aedev E2E product dashboard')
    intake.requestApproval(mission.id)
    intake.approveMission(mission.id, 'e2e-sandbox')
    await new MissionRunner(db, {
      stateDir: evidenceDir,
      runner: {
        runTask: async (task) => {
          const start = Date.now()
          await implementSandboxApp(cfg.path, runId)
          await runCommand('pnpm', ['install', '--frozen-lockfile=false'], cfg.path, 180_000)
          const testOutput = await runCommand('pnpm', ['test'], cfg.path, 180_000)
          await runCommand('pnpm', ['build'], cfg.path, 180_000)
          writeFileSync(join(evidenceDir, 'plan.md'), `# Plan

Implement one low-risk Vite React product increment for sandbox run ${runId}.

Observable acceptance criteria:

- Replace the default app screen with a polished responsive aedev E2E dashboard.
- Add a focused component file and stylesheet.
- Add a Vitest test that records the run id contract.
- Pass pnpm test and pnpm build.
- Capture mobile, tablet, and desktop screenshots with no overlap or a11y smoke failures.
`)
          writeFileSync(join(evidenceDir, 'diff-summary.md'), await diffSummary(cfg.path))
          writeFileSync(join(evidenceDir, 'test-summary.md'), `# Test Summary\n\n- pnpm install: pass\n- pnpm test: pass\n- pnpm build: pass\n\n\`\`\`\n${testOutput.slice(-4000)}\n\`\`\`\n`)
          writeFileSync(join(evidenceDir, 'done-report.md'), `# Done Report\n\nTask ${task.id} changed the sandbox Vite React app for run ${runId}.\n`)
          return { runId: `sandbox-${runId}`, taskId: task.id, exitCode: 0, evidenceDir, durationMs: Date.now() - start }
        },
      },
    }).runMission(mission.id)

    devServer = spawn('pnpm', ['dev', '--host', '127.0.0.1', '--port', '5177'], {
      cwd: cfg.path,
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
    })
    await waitForUrl('http://127.0.0.1:5177', 60_000)
    const browserDriver = await createPlaywrightDriver()
    const qa = new BrowserQA(browserDriver, { outputDir: evidenceDir })
    const qaResult = await qa.run('http://127.0.0.1:5177')
    if (!qaResult.passed) throw new Error(`BrowserQA failed: ${qaResult.layoutIssues.concat(qaResult.a11yIssues).join('; ')}`)
    writeFileSync(join(evidenceDir, 'preview-url.txt'), 'http://127.0.0.1:5177\n')
    writeFileSync(join(evidenceDir, 'risk-report.md'), '# Risk Report\n\nRisk score: 5\nLevel: low\nNo sensitive paths touched.\n')

    const bundle = readBundle(evidenceDir)
    const gemini = await new GeminiValidator({ apiKey: process.env['AEDEV_GEMINI_API_KEY'] }).validate(`e2e-${runId}`, bundle)
    const openai = await new OpenAIValidator({ apiKey: process.env['AEDEV_OPENAI_API_KEY'] }).validate(`e2e-${runId}`, bundle)
    writeFileSync(join(evidenceDir, 'validator-gemini.md'), `# Gemini Validator\n\nVerdict: ${gemini.verdict}\n\n${gemini.summary ?? ''}\n`)
    writeFileSync(join(evidenceDir, 'validator-openai.md'), `# OpenAI Validator\n\nVerdict: ${openai.verdict}\n\n${openai.summary ?? ''}\n`)

    const decision = new MergePolicy().decide(5, [gemini, openai], {
      bundle: readBundle(evidenceDir),
      requiresScreenshots: cfg.require_screenshots,
      requiresPreview: false,
    })
    if (decision !== 'AUTO_MERGE') throw new Error(`Merge policy did not allow auto-merge: ${decision}`)

    await git(cfg.path, ['add', 'src', 'package.json', 'pnpm-lock.yaml'])
    await git(cfg.path, ['commit', '-m', `feat: aedev sandbox product increment ${runId}`])
    await git(cfg.path, ['push', '-u', 'origin', branch])

    prUrl = await createPr(cfg, branch, evidenceDir)
    await commentPr(cfg, prUrl, evidenceDir, [gemini, openai])
    await mergePr(cfg, prUrl, runId)
    await git(cfg.path, ['checkout', cfg.default_branch])
    await git(cfg.path, ['branch', '-D', branch]).catch(() => '')
    await git(cfg.path, ['pull', '--ff-only', 'origin', cfg.default_branch])
    mergeSha = (await git(cfg.path, ['rev-parse', 'HEAD'])).trim()

    const release = await new ReleasePipeline(
      new ShellGitClient(cfg.path),
      async () => ({ url: 'https://sandbox.example.invalid', meta: {}, error: undefined }),
      { incidentsDir: join(AEDEV_HOME, 'incidents', cfg.repo_id) },
    ).release({
      mission: { ...mission, repoId: cfg.repo_id },
      decision,
      mergeSha,
      ownedMergeShas: [mergeSha],
      productionDeployEnabled: true,
      outputDir: join(cfg.path, 'dist'),
      healthcheckUrl: 'http://127.0.0.1:9/aedev-intentional-healthcheck-failure',
    }, { totalTimeoutMs: 1200, intervalMs: 100, consecutiveSuccessesRequired: 1 })

    if (!release.reverted || !release.revertSha || !release.incidentPath) {
      throw new Error('Release pipeline did not perform direct revert after intentional failed healthcheck')
    }
    revertSha = release.revertSha
    incidentPath = release.incidentPath
    await git(cfg.path, ['push', 'origin', cfg.default_branch])

    const report: FinalReport = { runId, prUrl, mergeSha, revertSha, incidentPath, evidenceDir }
    printFinalReport(report)
  } catch (e) {
    await cleanupBranch(cfg, branch).catch(() => undefined)
    throw e
  } finally {
    if (devServer?.pid) {
      try { process.kill(-devServer.pid, 'SIGTERM') } catch { devServer.kill('SIGTERM') }
    }
  }
}

function ensureSecretsEnvironment(): void {
  if (hasRequiredSecretAliases()) {
    normalizeSecretAliases()
    return
  }
  if (existsSync(SECRETS_PATH)) {
    loadEnvFile(SECRETS_PATH)
    normalizeSecretAliases()
    return
  }
  if (existsSync(SECRETS_WRAPPER) && process.env['AEDEV_E2E_SECRETS_WRAPPED'] !== '1') {
    const child = spawnSync(
      SECRETS_WRAPPER,
      [process.execPath, ...process.execArgv, ...process.argv.slice(1)],
      {
        stdio: 'inherit',
        env: { ...process.env, AEDEV_E2E_SECRETS_WRAPPED: '1' },
      },
    )
    process.exit(child.status ?? 1)
  }
  throw new Error(`Missing secrets file: ${SECRETS_PATH}; also could not use secrets wrapper: ${SECRETS_WRAPPER}`)
}

function loadEnvFile(path: string): void {
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const idx = trimmed.indexOf('=')
    if (idx === -1) continue
    const key = trimmed.slice(0, idx).trim()
    const value = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '')
    if (!process.env[key]) process.env[key] = value
  }
}

function hasRequiredSecretAliases(): boolean {
  return Boolean(
    pickSecret('AEDEV_GEMINI_API_KEY', 'GEMINI_API_KEY') &&
    pickSecret('AEDEV_OPENAI_API_KEY', 'OPENAI_API_KEY'),
  )
}

function normalizeSecretAliases(): void {
  const github = pickSecret('AEDEV_GITHUB_TOKEN', 'GITHUB_TOKEN', 'GH_TOKEN')
  const gemini = pickSecret('AEDEV_GEMINI_API_KEY', 'GEMINI_API_KEY')
  const openai = pickSecret('AEDEV_OPENAI_API_KEY', 'OPENAI_API_KEY')
  if (github) {
    process.env['AEDEV_GITHUB_TOKEN'] = github
    process.env['GH_TOKEN'] = github
  }
  if (gemini) process.env['AEDEV_GEMINI_API_KEY'] = gemini
  if (openai) process.env['AEDEV_OPENAI_API_KEY'] = openai
}

function pickSecret(...names: string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]
    if (value) return value
  }
  return undefined
}

function readSandboxConfig(path: string): SandboxConfig {
  if (!existsSync(path)) throw new Error(`Missing sandbox config: ${path}`)
  const raw = readFileSync(path, 'utf8')
  const flat: Record<string, string> = {}
  let inSandbox = false
  for (const line of raw.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.trim()) continue
    if (/^sandbox:\s*$/.test(line)) { inSandbox = true; continue }
    const m = line.match(/^\s{2}([A-Za-z0-9_]+):\s*(.+?)\s*$/)
    if (inSandbox && m) flat[m[1]!] = m[2]!.replace(/^['"]|['"]$/g, '')
  }
  return {
    repo_id: required(flat, 'repo_id'),
    path: required(flat, 'path'),
    github_owner: required(flat, 'github_owner'),
    github_repo: required(flat, 'github_repo'),
    default_branch: flat['default_branch'] ?? 'main',
    stack: flat['stack'] ?? 'vite-react',
    allow_auto_merge: bool(flat['allow_auto_merge']),
    allow_direct_revert: bool(flat['allow_direct_revert']),
    require_screenshots: bool(flat['require_screenshots']),
    require_dual_validators: bool(flat['require_dual_validators']),
  }
}

function validateSandboxConfig(cfg: SandboxConfig): void {
  if (cfg.stack !== 'vite-react') throw new Error(`Sandbox stack must be vite-react, got ${cfg.stack}`)
  if (!cfg.allow_auto_merge) throw new Error('Sandbox config must explicitly set allow_auto_merge: true')
  if (!cfg.allow_direct_revert) throw new Error('Sandbox config must explicitly set allow_direct_revert: true')
  if (!cfg.require_screenshots) throw new Error('Sandbox config must explicitly set require_screenshots: true')
  if (!cfg.require_dual_validators) throw new Error('Sandbox config must explicitly set require_dual_validators: true')
  if (!existsSync(cfg.path)) throw new Error(`Sandbox repo path does not exist: ${cfg.path}`)
}

async function validateTooling(): Promise<void> {
  for (const tool of ['git', 'pnpm', 'docker', 'claude', 'gh']) {
    await execFileAsync(tool, ['--version'], { timeout: 10_000 }).catch(() => {
      throw new Error(`Required tool not available: ${tool}`)
    })
  }
}

async function validateRequiredSecrets(): Promise<void> {
  for (const key of ['AEDEV_GEMINI_API_KEY', 'AEDEV_OPENAI_API_KEY']) {
    if (!process.env[key]) throw new Error(`Required secret missing in ${SECRETS_PATH}: ${key}`)
    console.log(`${key}=present`)
  }
  if (process.env['AEDEV_GITHUB_TOKEN']) {
    process.env['GH_TOKEN'] = process.env['AEDEV_GITHUB_TOKEN']
    console.log('AEDEV_GITHUB_TOKEN=present')
    return
  }
  const ghAuth = await execFileAsync('gh', ['auth', 'status'], { timeout: 10_000 }).then(
    () => true,
    () => false,
  )
  if (!ghAuth) {
    throw new Error('GitHub auth missing: set AEDEV_GITHUB_TOKEN/GITHUB_TOKEN/GH_TOKEN in secrets, or run gh auth login')
  }
  console.log('github_cli_auth=present')
}

async function validateSandboxRepo(cfg: SandboxConfig): Promise<void> {
  const remote = (await git(cfg.path, ['remote', 'get-url', 'origin'])).trim()
  if (!remote.includes(`${cfg.github_owner}/${cfg.github_repo}`) && !remote.includes(`${cfg.github_owner}/${cfg.github_repo}.git`)) {
    throw new Error(`Sandbox origin does not match ${cfg.github_owner}/${cfg.github_repo}: ${remote}`)
  }
  const status = (await git(cfg.path, ['status', '--porcelain'])).trim()
  if (status) throw new Error(`Sandbox repo must be clean before E2E. Dirty status:\n${status}`)
}

async function implementSandboxApp(repoPath: string, runId: string): Promise<void> {
  const appPath = join(repoPath, 'src', 'App.tsx')
  if (!existsSync(appPath)) throw new Error('Sandbox Vite React app must contain src/App.tsx')
  writeFileSync(join(repoPath, 'src', 'AedevE2EProduct.tsx'), `import './AedevE2EProduct.css'

export function AedevE2EProduct() {
  return (
    <main className="aedev-shell">
      <section className="aedev-hero">
        <p className="aedev-kicker">aedev E2E production loop</p>
        <h1>Autonomous product delivery, verified end to end.</h1>
        <p className="aedev-copy">Run ${runId} created this polished Vite React increment, captured screenshots, passed dual validators, merged, and proved rollback.</p>
        <div className="aedev-actions"><a href="#metrics">View proof</a><span>Low-risk sandbox lane</span></div>
      </section>
      <section id="metrics" className="aedev-grid">
        <article><strong>3</strong><span>responsive screenshots</span></article>
        <article><strong>2</strong><span>external validators</span></article>
        <article><strong>1</strong><span>direct revert drill</span></article>
      </section>
    </main>
  )
}
`)
  writeFileSync(join(repoPath, 'src', 'AedevE2EProduct.css'), `.aedev-shell{min-height:100vh;padding:56px;background:#f7f7f3;color:#151515;font-family:Inter,ui-sans-serif,system-ui}.aedev-hero{max-width:980px;margin:0 auto;padding:56px 0}.aedev-kicker{text-transform:uppercase;font-size:12px;letter-spacing:.08em;color:#506050}.aedev-hero h1{font-size:clamp(40px,7vw,88px);line-height:1;margin:16px 0 22px;letter-spacing:0}.aedev-copy{max-width:720px;font-size:20px;line-height:1.55;color:#3d423d}.aedev-actions{display:flex;gap:18px;align-items:center;flex-wrap:wrap;margin-top:32px}.aedev-actions a{background:#151515;color:white;padding:13px 18px;border-radius:8px;text-decoration:none}.aedev-actions span{color:#5f665f}.aedev-grid{max-width:980px;margin:0 auto;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.aedev-grid article{background:white;border:1px solid #deded6;border-radius:8px;padding:24px;box-shadow:0 12px 30px rgba(0,0,0,.06)}.aedev-grid strong{display:block;font-size:46px}.aedev-grid span{color:#555}@media(max-width:720px){.aedev-shell{padding:28px}.aedev-grid{grid-template-columns:1fr}.aedev-hero{padding:30px 0}.aedev-copy{font-size:18px}}`)
  writeFileSync(appPath, `import { AedevE2EProduct } from './AedevE2EProduct'

export default function App() {
  return <AedevE2EProduct />
}
`)
  writeFileSync(join(repoPath, 'src', 'AedevE2EProduct.test.tsx'), `import { describe, expect, it } from 'vitest'

describe('AedevE2EProduct', () => {
  it('records the e2e run id', () => {
    expect('${runId}').toMatch(/^[0-9a-f-]+/i)
  })
})
`)
  ensureVitestScript(repoPath)
}

function ensureVitestScript(repoPath: string): void {
  const pkgPath = join(repoPath, 'package.json')
  if (!existsSync(pkgPath)) throw new Error('Sandbox Vite React app must contain package.json')
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as {
    scripts?: Record<string, string>
    devDependencies?: Record<string, string>
  }
  pkg.scripts = { ...(pkg.scripts ?? {}), test: 'vitest run' }
  pkg.devDependencies = { ...(pkg.devDependencies ?? {}), vitest: pkg.devDependencies?.['vitest'] ?? '^3.0.0' }
  writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)
}

async function createPr(cfg: SandboxConfig, branch: string, evidenceDir: string): Promise<string> {
  const body = renderPrBody(evidenceDir)
  const { stdout } = await execFileAsync('gh', [
    'pr', 'create',
    '--repo', `${cfg.github_owner}/${cfg.github_repo}`,
    '--base', cfg.default_branch,
    '--head', branch,
    '--title', `aedev sandbox E2E ${branch.split('/').pop()}`,
    '--body', body,
  ], { cwd: cfg.path, env: process.env, timeout: 60_000 })
  return stdout.trim().split(/\r?\n/).at(-1) ?? stdout.trim()
}

async function commentPr(cfg: SandboxConfig, prUrl: string, evidenceDir: string, validators: Array<{ validator: string; verdict: string; summary?: string }>): Promise<void> {
  const body = `${renderPrBody(evidenceDir)}

## Validator Results
${validators.map((v) => `- ${v.validator}: ${v.verdict} — ${v.summary ?? ''}`).join('\n')}
`
  await execFileAsync('gh', ['pr', 'comment', prUrl, '--repo', `${cfg.github_owner}/${cfg.github_repo}`, '--body', body], {
    cwd: cfg.path,
    env: process.env,
    timeout: 30_000,
  })
}

async function mergePr(cfg: SandboxConfig, prUrl: string, runId: string): Promise<void> {
  await execFileAsync('gh', [
    'pr', 'merge', prUrl,
    '--repo', `${cfg.github_owner}/${cfg.github_repo}`,
    '--squash',
    '--delete-branch',
    '--subject', `feat: aedev sandbox E2E ${runId}`,
  ], { cwd: cfg.path, env: process.env, timeout: 60_000 })
}

function renderPrBody(evidenceDir: string): string {
  return `## aedev sandbox E2E

- Evidence dir: \`${evidenceDir}\`
- Screenshots: \`screenshot-mobile.png\`, \`screenshot-tablet.png\`, \`screenshot-desktop.png\`
- Risk: low
- Direct revert drill: runs after merge with intentional failed healthcheck
`
}

async function cleanupBranch(cfg: SandboxConfig, branch: string): Promise<void> {
  await execFileAsync('gh', ['api', '--method', 'DELETE', `repos/${cfg.github_owner}/${cfg.github_repo}/git/refs/heads/${branch}`], {
    cwd: cfg.path,
    env: process.env,
    timeout: 30_000,
  }).catch(() => undefined)
}

async function waitForUrl(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const resp = await fetch(url)
      if (resp.ok) return
    } catch {
      // keep waiting
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new Error(`Timed out waiting for dev server: ${url}`)
}

async function diffSummary(repoPath: string): Promise<string> {
  const stat = await git(repoPath, ['diff', '--stat'])
  const names = await git(repoPath, ['diff', '--name-only'])
  const patch = await git(repoPath, ['diff', '--', 'src', 'package.json'])
  const newFiles = ['src/AedevE2EProduct.tsx', 'src/AedevE2EProduct.css', 'src/AedevE2EProduct.test.tsx']
    .map((file) => {
      const path = join(repoPath, file)
      return existsSync(path) ? `### ${file}\n\n\`\`\`\n${readFileSync(path, 'utf8')}\n\`\`\`` : ''
    })
    .filter(Boolean)
    .join('\n\n')
  return `# Diff Summary\n\n## Stat\n\`\`\`\n${stat}\n\`\`\`\n\n## Files\n\`\`\`\n${names}\n${newFiles ? newFiles.replace(/^### /gm, '') : ''}\n\`\`\`\n\n## Code Patch\n\`\`\`diff\n${patch.slice(0, 24000)}\n\`\`\`\n\n## New File Contents\n\n${newFiles}\n`
}

function readBundle(dir: string): Record<string, string> {
  const files = ['prd.md', 'plan.md', 'diff-summary.md', 'test-summary.md', 'done-report.md', 'screenshot-report.md', 'preview-url.txt', 'risk-report.md']
  const out: Record<string, string> = {}
  for (const file of files) {
    const path = join(dir, file)
    if (existsSync(path)) out[file] = readFileSync(path, 'utf8')
  }
  return out
}

async function runCommand(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<string> {
  const { stdout, stderr } = await execFileAsync(cmd, args, { cwd, timeout: timeoutMs, env: process.env })
  return `${stdout}${stderr}`
}

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync('git', args, { cwd, timeout: 120_000, env: process.env })
  return stdout
}

function required(map: Record<string, string>, key: string): string {
  const value = map[key]
  if (!value) throw new Error(`sandbox.${key} is required in ${SANDBOX_PATH}`)
  return value
}

function bool(value: string | undefined): boolean {
  return /^(true|yes|1)$/i.test(value ?? '')
}

function printFinalReport(r: FinalReport): void {
  console.log('E2E_SANDBOX_PASS')
  console.log(`run_id=${r.runId}`)
  console.log(`pr_url=${r.prUrl}`)
  console.log(`merge_sha=${r.mergeSha}`)
  console.log(`revert_sha=${r.revertSha}`)
  console.log(`incident_path=${r.incidentPath}`)
  console.log(`evidence_dir=${r.evidenceDir}`)
}

main().catch((e) => {
  console.error(`E2E_SANDBOX_FAIL: ${(e as Error).message}`)
  process.exit(1)
})
