import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { chromium } from 'playwright'
import { AedevDb } from '@aedev/core'
import { createServer } from '@aedev/daemon'

const DAEMON_PORT = Number(process.env['AEDEV_COCKPIT_E2E_DAEMON_PORT'] ?? '7257')
const DASHBOARD_PORT = Number(process.env['AEDEV_COCKPIT_E2E_DASHBOARD_PORT'] ?? '7258')

process.env['AEDEV_COCKPIT_FORCE_MOCK'] = '1'
process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '1'
process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
process.env['AEDEV_DISABLE_CODEX_CLI'] = '1'
process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
process.env['AEDEV_DISABLE_OPENAI_API'] = '1'

const stateDir = mkdtempSync(join(tmpdir(), 'aedev-cockpit-e2e-'))
const db = new AedevDb(':memory:')
let dashboard: ChildProcess | undefined
const daemon = createServer(db, new Date(), stateDir)
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

async function main(): Promise<void> {
try {
  db.insertRepo({
    name: 'cockpit-e2e',
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
  dashboard.stdout?.on('data', (d) => process.stdout.write(`[dashboard] ${d}`))
  dashboard.stderr?.on('data', (d) => process.stderr.write(`[dashboard] ${d}`))
  await waitFor(`http://127.0.0.1:${DASHBOARD_PORT}`)
  await waitFor(`http://127.0.0.1:${DASHBOARD_PORT}/api/operator/sessions`)

  browser = await chromium.launch()
  const page = await browser.newPage()
  await page.goto(`http://127.0.0.1:${DASHBOARD_PORT}`, { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Start Brainstorm/ }).first().click()
  await page.getByText('Initial brainstorm:', { exact: false }).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: /Generate PRD/ }).first().click()
  await page.getByText('Approval Gate').waitFor({ timeout: 10_000 })
  await page.locator('text=pending').first().waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: /Approve/ }).first().click()
  await page.locator('text=approved').first().waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: /Start/ }).first().click()
  await page.getByText('mock worker', { exact: false }).waitFor({ timeout: 10_000 })
  await page.getByRole('button', { name: /Draft PR/ }).first().click()
  await page.getByText('REMOTE_WRITES_DISABLED', { exact: false }).first().waitFor({ timeout: 10_000 })
  await browser.close()
  browser = undefined

  const mission = db.listMissions()[0]
  if (!mission) throw new Error('No mission was created')
  if (mission.githubPrUrl) throw new Error(`Unexpected PR URL was created: ${mission.githubPrUrl}`)
  const overviewRes = await fetch(`http://127.0.0.1:${DAEMON_PORT}/missions/${mission.id}/overview`)
  const overview = await overviewRes.json() as { stage: string; runs: unknown[]; artifacts: unknown[]; validatorStatus?: string }
  if (overview.stage !== 'PR/Waiting/Blocked') throw new Error(`Expected evidence gate stage, got ${overview.stage}`)
  if (overview.runs.length !== 1) throw new Error(`Expected 1 mock run, got ${overview.runs.length}`)
  if (overview.artifacts.length === 0) throw new Error('Expected artifacts to be registered')
  console.log('Operator Cockpit deterministic e2e PASS')
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
