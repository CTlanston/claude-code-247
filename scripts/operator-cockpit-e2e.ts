import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { chromium, type Page } from 'playwright'
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

// Deterministic adaptive-clarify journey (current product contract, GR#11 /
// conversation-first + ClarificationPopup): the brainstorm round asks two
// questions at confidence 62 (plan locked); the follow-up round after the
// operator answers reaches confidence 96 (plan unlocked). Same fenced-JSON
// fixture mechanism as scripts/operator-cockpit-user-e2e.ts — no live CLI.
process.env['AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT'] = [
  'Initial brainstorm: deterministic e2e fixture round.',
  '',
  '- The goal needs two confirmations before a safe plan.',
  '- Nothing has been changed yet — planning only.',
  '',
  '```json',
  JSON.stringify({
    questions: [
      {
        field: 'scope',
        question: 'How tightly should this mission be scoped?',
        why: 'Scoping avoids an unbounded first mission.',
        impact: 'It decides the roadmap and the worker prompt.',
        destination: 'PRD/Roadmap',
        options: [{ label: 'Smallest viable change', recommended: true }, { label: 'A broader multi-file pass' }],
      },
      {
        field: 'acceptance-criteria',
        question: 'What is the most important observable acceptance criterion?',
        why: 'A verifiable acceptance criterion gates execution.',
        impact: 'It defines the evidence the validator reads.',
        destination: 'PRD/Roadmap',
        options: [{ label: 'A specific test/command must pass', recommended: true }, { label: 'A named UI behavior must change' }],
      },
    ],
    confidence: 62,
    rationale: 'Two answers are still needed before a safe roadmap.',
  }),
  '```',
].join('\n')
process.env['AEDEV_COCKPIT_PLANNER_FOLLOWUP_FIXTURE_TEXT'] = [
  'Thanks — your answers are enough to plan safely. · 你的回答已足够，可以生成方案了。',
  '',
  '```json',
  JSON.stringify({ questions: [], confidence: 96, rationale: 'Operator answers resolved scope and acceptance.' }),
  '```',
].join('\n')

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
  await page.getByTestId('cockpit-start-brainstorm').click()
  await page.getByText('Initial brainstorm:', { exact: false }).waitFor({ timeout: 10_000 })
  // Clarification answering moved into the bottom-anchored ClarificationPopup
  // (conversation-first + five-card surface is the default; WORKBOOK_v6 GR#11).
  // Same selector contract as scripts/operator-cockpit-user-e2e.ts: pick the
  // recommended chip per question, then submit through the popup.
  const popup = page.locator('.ck-clar-popup')
  await popup.waitFor({ timeout: 20_000 })
  const questions = popup.locator('.ck-clar-q')
  const count = await questions.count()
  if (count < 1) throw new Error('Clarification popup rendered with no questions')
  for (let i = 0; i < count; i++) {
    const recommended = questions.nth(i).locator('.ck-chip.recommended')
    if (await recommended.count()) await recommended.first().click()
    else await questions.nth(i).locator('.ck-chip').first().click()
  }
  await popup.getByRole('button', { name: /Answer all/ }).click()
  await page.getByText('已确认 · Clarifications', { exact: false }).first().waitFor({ timeout: 15_000 })
  await popup.waitFor({ state: 'detached', timeout: 15_000 })
  // The confidence gate stays locked (62 < 95) until the planner re-checks with
  // the answers folded in — Ask Until Clear runs the follow-up round (96).
  await page.getByRole('button', { name: /Ask Until Clear/ }).click()
  await page.getByText('your answers are enough to plan safely', { exact: false }).first().waitFor({ timeout: 20_000 })
  await page.getByTestId('cockpit-generate-plan-primary').click()
  await page.getByTestId('mission-stage').waitFor({ timeout: 10_000 })
  await page.getByTestId('cockpit-approve-roadmap').click()
  await page.getByTestId('cockpit-start-execution').click()
  await waitForRootStage(page, ['validators_missing', 'evidence_ready', 'pr_ready'])
  await page.getByTestId('cockpit-check-draft-pr-gate').click()
  await page.getByTestId('cockpit-pr-gate-card').waitFor({ timeout: 10_000 })
  // The Gemini evidence-only hard gate is evaluated BEFORE the remote-writes
  // gate; with no Gemini verdict configured the deterministic blocked code is
  // GEMINI_NOT_CONFIGURED (same contract the quality smoke asserts).
  const code = await page.getByTestId('cockpit-pr-gate-card').getAttribute('data-pr-gate-code')
  if (code !== 'GEMINI_NOT_CONFIGURED') throw new Error(`Expected GEMINI_NOT_CONFIGURED, got ${code}`)
  await browser.close()
  browser = undefined

  const mission = db.listMissions()[0]
  if (!mission) throw new Error('No mission was created')
  if (mission.githubPrUrl) throw new Error(`Unexpected PR URL was created: ${mission.githubPrUrl}`)
  const overviewRes = await fetch(`http://127.0.0.1:${DAEMON_PORT}/missions/${mission.id}/overview`)
  const overview = await overviewRes.json() as { stage: string; operatorView?: { stage: string }; runs: unknown[]; artifacts: unknown[]; validatorStatus?: string }
  if (overview.operatorView?.stage !== 'pr_blocked') throw new Error(`Expected pr_blocked operator stage, got ${overview.operatorView?.stage ?? overview.stage}`)
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

async function waitForRootStage(page: Page, stages: string[], timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const stage = await page.getByTestId('cockpit-root').getAttribute('data-stage')
    if (stage && stages.includes(stage)) return
    await page.waitForTimeout(200)
  }
  throw new Error(`Timed out waiting for root stage in ${stages.join(', ')}`)
}
