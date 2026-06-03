import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { chromium, type Page } from 'playwright'
import { AedevDb } from '@aedev/core'
import { createServer } from '@aedev/daemon'

const DAEMON_PORT = Number(process.env['AEDEV_COCKPIT_QUALITY_DAEMON_PORT'] ?? '7287')
const DASHBOARD_PORT = Number(process.env['AEDEV_COCKPIT_QUALITY_DASHBOARD_PORT'] ?? '7288')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT_DIR = resolve(process.env['AEDEV_COCKPIT_QUALITY_DIR'] ?? join(process.cwd(), 'evidence/browser-cockpit-quality', STAMP))

process.env['AEDEV_COCKPIT_FORCE_MOCK'] = '1'
process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '1'
process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
process.env['AEDEV_DISABLE_CODEX_CLI'] = '1'
process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
process.env['AEDEV_DISABLE_OPENAI_API'] = '1'

const stateDir = mkdtempSync(join(tmpdir(), 'aedev-cockpit-quality-'))
const db = new AedevDb(':memory:')
const daemon = createServer(db, new Date(), stateDir)
let dashboard: ChildProcess | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const evidence: string[] = []
const consoleIssues: string[] = []

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

async function main(): Promise<void> {
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    db.insertRepo({
      name: 'cockpit-quality',
      path: stateDir,
      defaultBranch: 'main',
      enabled: true,
      testCommands: [],
      forbiddenPaths: ['.env*', 'secrets/**', '.github/**', 'AGENTS.md'],
      riskRules: {},
      mergePolicy: 'WAITING',
    })

    await daemon.listen({ port: DAEMON_PORT, host: '127.0.0.1' })
    dashboard = spawn(join(process.cwd(), 'apps/dashboard/node_modules/.bin/vite'), ['--host', '127.0.0.1', '--port', String(DASHBOARD_PORT), '--strictPort'], {
      cwd: join(process.cwd(), 'apps/dashboard'),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, AEDEV_DAEMON_URL: `http://127.0.0.1:${DAEMON_PORT}` },
      detached: true,
    })
    dashboard.stderr?.on('data', (d) => process.stderr.write(`[dashboard] ${d}`))
    await waitFor(`http://127.0.0.1:${DASHBOARD_PORT}`)
    await waitFor(`http://127.0.0.1:${DASHBOARD_PORT}/api/operator/sessions`)

    browser = await chromium.launch()
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') consoleIssues.push(`${msg.type()}: ${msg.text()}`)
    })
    await page.goto(`http://127.0.0.1:${DASHBOARD_PORT}`, { waitUntil: 'domcontentloaded' })
    await assertConversationOnly(page)
    await page.getByTestId('cockpit-title-input').fill('Quality smoke visible UI')
    await page.getByTestId('cockpit-goal-input').fill('In the dashboard Cockpit page, verify the existing conversation UI quality smoke keeps the single conversation layout, status strip, and safe Draft PR gate visible without changing product behavior. Acceptance: browser smoke passes and evidence screenshots are written.')
    await assertOnePrimary(page, 'cockpit-start-brainstorm')
    await shot(page, '01-new')

    await page.getByTestId('cockpit-start-brainstorm').click()
    await page.getByText('Initial brainstorm:', { exact: false }).waitFor({ timeout: 10_000 })
    await assertOnePrimary(page, 'cockpit-generate-plan-primary')
    await assertConversationOnly(page)
    await shot(page, '02-brainstorm-ready')

    await page.getByTestId('cockpit-generate-plan-primary').click()
    await page.getByTestId('cockpit-approve-roadmap').waitFor({ timeout: 10_000 })
    await assertOnePrimary(page, 'cockpit-approve-roadmap')
    await assertConversationOnly(page)
    await shot(page, '03-plan-approval')

    await page.getByTestId('cockpit-approve-roadmap').click()
    await page.getByTestId('cockpit-start-execution').waitFor({ timeout: 10_000 })
    await assertOnePrimary(page, 'cockpit-start-execution')
    await assertConversationOnly(page)
    await shot(page, '04-approved')

    await page.getByTestId('cockpit-start-execution').click()
    await waitForRootStage(page, ['validators_missing', 'evidence_ready', 'pr_ready'])
    await assertOnePrimary(page, 'cockpit-check-draft-pr-gate')
    await expectAttr(page, 'cockpit-root', 'data-provider-worker', 'mock')
    await expectAttr(page, 'cockpit-root', 'data-provider-planner', 'mock')
    await page.getByTestId('cockpit-test-mode').waitFor({ timeout: 5_000 })
    await assertConversationOnly(page)
    await shot(page, '05-evidence-ready')

    await page.getByTestId('cockpit-check-draft-pr-gate').click()
    await page.getByTestId('cockpit-pr-gate-card').waitFor({ timeout: 10_000 })
    await expectAttr(page, 'cockpit-root', 'data-pr-gate-code', 'GEMINI_NOT_CONFIGURED')
    await page.getByText('no branch push, no PR creation, no merge', { exact: false }).waitFor({ timeout: 5_000 })
    await assertConversationOnly(page)
    await shot(page, '06-pr-blocked')

    const mission = db.listMissions()[0]
    if (!mission) throw new Error('No mission created')
    if (mission.githubPrUrl) throw new Error(`Unexpected PR URL: ${mission.githubPrUrl}`)
    const events = db.queryEvents({ entityId: mission.id, limit: 12 })
    if (!events.some((e) => e.type === 'operator.draft_pr_blocked')) throw new Error('Missing operator.draft_pr_blocked event')

    const overview = await (await fetch(`http://127.0.0.1:${DAEMON_PORT}/missions/${mission.id}/overview`)).json() as {
      operatorView?: { stage: string; progressPercent: number; safetySummary?: { prGate?: { code?: string } } }
    }
    if (overview.operatorView?.stage !== 'pr_blocked') throw new Error(`Expected pr_blocked, got ${overview.operatorView?.stage}`)
    if (overview.operatorView.safetySummary?.prGate?.code !== 'GEMINI_NOT_CONFIGURED') throw new Error('Missing PR gate block code in operatorView')
    if (consoleIssues.length) throw new Error(`Browser console issues: ${consoleIssues.join('; ')}`)

    writeFileSync(join(OUT_DIR, 'dom-state-summary.json'), JSON.stringify({
      stage: await page.getByTestId('cockpit-root').getAttribute('data-stage'),
      planner: await page.getByTestId('cockpit-root').getAttribute('data-provider-planner'),
      worker: await page.getByTestId('cockpit-root').getAttribute('data-provider-worker'),
      prGateCode: await page.getByTestId('cockpit-root').getAttribute('data-pr-gate-code'),
    }, null, 2))
    writeFileSync(join(OUT_DIR, 'db-state-summary.json'), JSON.stringify({
      mission: { id: mission.id, status: mission.status, githubPrUrl: mission.githubPrUrl ?? null },
      operatorView: overview.operatorView,
    }, null, 2))
    writeFileSync(join(OUT_DIR, 'event-tail.json'), JSON.stringify(events.map((e) => ({ type: e.type, payload: e.payload, createdAt: e.createdAt })), null, 2))
    writeFileSync(join(OUT_DIR, 'console-logs.json'), JSON.stringify(consoleIssues, null, 2))
    writeFileSync(join(OUT_DIR, 'quality-smoke.md'), [
      '# Operator Cockpit WebUI Quality Smoke',
      '',
      `Result: PASS`,
      `Mission: ${mission.id}`,
      `Stage: ${overview.operatorView.stage}`,
      `PR gate: ${overview.operatorView.safetySummary?.prGate?.code ?? 'none'}`,
      '',
      'Assertions:',
      '- cockpit renders as one conversation column plus the three-part status strip',
      '- legacy Project Pulse, sidebar, inspector, and tabbed panels are absent',
      '- one primary action per stage',
      '- stable testids for core controls',
      '- planner/worker provider badges expose mock test mode',
      '- PR URL stayed empty while Gemini hard gate was not configured',
      '- draft PR blocked card reassures no push, PR, or merge occurred',
      '- browser console had no error/warning',
    ].join('\n'))
    console.log(`Operator Cockpit WebUI quality smoke PASS — evidence in ${OUT_DIR}`)
  } finally {
    await browser?.close().catch(() => undefined)
    if (dashboard?.pid) {
      try { process.kill(-dashboard.pid, 'SIGTERM') } catch { dashboard.kill('SIGTERM') }
    }
    await daemon.close().catch(() => undefined)
    db.close()
    rmSync(stateDir, { recursive: true, force: true })
  }
}

async function assertOnePrimary(page: Page, expectedTestId: string): Promise<void> {
  const primaryCount = await page.locator('button.ck-btn.primary').count()
  if (primaryCount !== 1) throw new Error(`Expected exactly one primary button, got ${primaryCount}`)
  const target = page.getByTestId(expectedTestId)
  if (await target.count() !== 1) throw new Error(`Expected one ${expectedTestId}`)
}

async function assertConversationOnly(page: Page): Promise<void> {
  if (await page.locator('.ck-sidebar, .ck-inspector, .ck-tabs').count()) {
    throw new Error('Expected conversation-only Cockpit; found legacy sidebar/inspector/tabs')
  }
  if (await page.getByText('Project Pulse', { exact: false }).count()) {
    throw new Error('Project Pulse text should not be visible in P3 cockpit')
  }
  if (await page.getByTestId('cockpit-status-strip').count() !== 1) {
    throw new Error('Expected exactly one thin status strip')
  }
  if (await page.locator('.ck-main').count() !== 1) {
    throw new Error('Expected one conversation main column')
  }
}

async function expectAttr(page: Page, testId: string, attr: string, expected: string): Promise<void> {
  const actual = await page.getByTestId(testId).getAttribute(attr)
  if (actual !== expected) throw new Error(`Expected ${testId}.${attr}=${expected}, got ${actual}`)
}

async function waitForRootStage(page: Page, stages: string[], timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const stage = await page.getByTestId('cockpit-root').getAttribute('data-stage')
    if (stage && stages.includes(stage)) return
    await page.waitForTimeout(200)
  }
  throw new Error(`Timed out waiting for root stage in ${stages.join(', ')}`)
}

async function shot(page: Page, name: string): Promise<void> {
  const file = join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  evidence.push(file)
}

async function waitFor(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}
