import { mkdirSync, mkdtempSync, rmSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { chromium, type Page } from 'playwright'
import { AedevDb } from '@aedev/core'
import { createServer } from '@aedev/daemon'

const DAEMON_PORT = Number(process.env['AEDEV_COCKPIT_SCREENS_DAEMON_PORT'] ?? '7267')
const DASHBOARD_PORT = Number(process.env['AEDEV_COCKPIT_SCREENS_DASHBOARD_PORT'] ?? '7268')
const OUT_DIR = resolve(process.env['AEDEV_COCKPIT_SCREENS_DIR'] ?? join(process.cwd(), 'evidence/launch/cockpit-screens'))

// Deterministic, offline, safety-gated: no real CLI, no validators, no remote writes.
process.env['AEDEV_COCKPIT_FORCE_MOCK'] = '1'
process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '1'
process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
process.env['AEDEV_DISABLE_CODEX_CLI'] = '1'
process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
process.env['AEDEV_DISABLE_OPENAI_API'] = '1'
// Hold the mock worker in a running state long enough to screenshot a genuine in-progress run.
process.env['AEDEV_COCKPIT_MOCK_DELAY_MS'] = process.env['AEDEV_COCKPIT_MOCK_DELAY_MS'] ?? '6000'

const LONG_CHINESE_PROMPT = '我希望你帮我把团队内部的发布流程做一次系统性的梳理与自动化改造：'
  + '第一，整理当前从需求评审、方案设计、代码实现、测试验证到灰度发布的完整链路，找出其中重复且容易出错的人工环节；'
  + '第二，给出一个低风险、可回滚、带证据门禁的改造路线图，并明确每一步需要我确认的关键问题；'
  + '第三，所有改动都必须停在 draft PR 与 evidence gate，绝不允许自动合并或推送到远端，安全永远优先于速度。'

const stateDir = mkdtempSync(join(tmpdir(), 'aedev-cockpit-screens-'))
const db = new AedevDb(':memory:')
const daemon = createServer(db, new Date(), stateDir)
let dashboard: ChildProcess | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const written: string[] = []

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

async function main(): Promise<void> {
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    db.insertRepo({
      name: 'cockpit-screens',
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

    // --- Desktop viewport: full guided flow ---
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    await page.goto(`http://127.0.0.1:${DASHBOARD_PORT}`, { waitUntil: 'domcontentloaded' })
    await shot(page, '01-desktop-initial')

    await page.getByTestId('cockpit-start-brainstorm').click()
    await page.getByText('Initial brainstorm:', { exact: false }).waitFor({ timeout: 10_000 })
    await page.getByTestId('cockpit-generate-plan-primary').waitFor({ timeout: 10_000 })
    await shot(page, '02-desktop-brainstorm-choices')

    // Real planner follow-up: clicking "ask 3 questions" yields an assistant reply with questions.
    await page.getByRole('button', { name: /Ask 3 Questions/ }).click()
    await page.getByText('Operator Questions', { exact: false }).first().waitFor({ timeout: 10_000 })
    await shot(page, '03-desktop-ask-questions')

    await page.getByTestId('cockpit-generate-plan-primary').click()
    await page.getByTestId('cockpit-approve-roadmap').waitFor({ timeout: 10_000 })
    await shot(page, '04-desktop-roadmap')

    await page.getByTestId('cockpit-approve-roadmap').click()
    await page.getByTestId('cockpit-start-execution').waitFor({ timeout: 10_000 })
    await shot(page, '05-desktop-approved')

    // Start execution; the mock worker is held in `running` so this is a GENUINE in-progress shot.
    await page.getByTestId('cockpit-start-execution').click()
    await page.getByText('mock: running', { exact: false }).first().waitFor({ timeout: 15_000 })
    await shot(page, '06-desktop-running-worker')

    // Then the completed evidence state once the held worker finishes.
    await page.getByText('mock: done', { exact: false }).first().waitFor({ timeout: 15_000 })
    await shot(page, '07-desktop-evidence-complete')

    await page.getByTestId('cockpit-check-draft-pr-gate').click()
    await page.getByText('REMOTE_WRITES_DISABLED', { exact: false }).first().waitFor({ timeout: 10_000 })
    await shot(page, '08-desktop-draft-pr-blocked')

    // Long Chinese prompt (also exercises the sidebar New reset button).
    await page.getByTestId('cockpit-new-mission').click()
    await page.locator('textarea').first().fill(LONG_CHINESE_PROMPT)
    await shot(page, '09-desktop-long-chinese-prompt')
    await page.close()

    // --- Mobile / small viewport ---
    const mobile = await browser.newPage({ viewport: { width: 390, height: 844 } })
    await mobile.goto(`http://127.0.0.1:${DASHBOARD_PORT}`, { waitUntil: 'domcontentloaded' })
    await shot(mobile, '10-mobile-initial')
    await mobile.getByTestId('cockpit-new-mission').click() // reset to the new-mission composer (daemon already has the desktop session)
    await mobile.getByTestId('cockpit-start-brainstorm').click()
    await mobile.getByText('Initial brainstorm:', { exact: false }).waitFor({ timeout: 10_000 })
    await shot(mobile, '11-mobile-brainstorm')
    await mobile.close()

    await browser.close()
    browser = undefined

    const missing = written.filter((p) => !(statSync(p).size > 1000))
    if (missing.length) throw new Error(`Screenshots were empty or too small: ${missing.join(', ')}`)
    console.log(`Operator Cockpit screenshots PASS — ${written.length} images in ${OUT_DIR}`)
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

async function shot(page: Page, name: string): Promise<void> {
  const path = join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path, fullPage: true })
  written.push(path)
  console.log(`[screenshot] ${path}`)
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
