/**
 * Operator Cockpit — real browser-level USER journey E2E (v-ux-2).
 *
 * Drives the cockpit the way a non-developer operator would: type a goal,
 * watch visible planning progress, answer the clarification popup through the
 * real UI controls, generate/approve the plan, start execution, read the loop
 * summary evidence, and hit the Draft PR safety gate — asserting at every step
 * that the conversation stays human (no raw gate/HTTP codes in visible text).
 *
 * Same harness pattern as operator-cockpit-webui-quality-smoke.ts:
 * mock/template env, in-process daemon via createServer, dashboard via vite,
 * chromium via playwright (PLAYWRIGHT_BROWSERS_PATH is honored from the env),
 * screenshots + a final markdown report under
 * evidence/browser-cockpit-user-e2e/<timestamp>/.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve } from 'path'
import { spawn, type ChildProcess } from 'child_process'
import { chromium, type Page } from 'playwright'
import { AedevDb } from '@aedev/core'
import { createServer } from '@aedev/daemon'

const DAEMON_PORT = Number(process.env['AEDEV_COCKPIT_USER_E2E_DAEMON_PORT'] ?? '7291')
const DASHBOARD_PORT = Number(process.env['AEDEV_COCKPIT_USER_E2E_DASHBOARD_PORT'] ?? '7292')
const STAMP = new Date().toISOString().replace(/[:.]/g, '-')
const OUT_DIR = resolve(process.env['AEDEV_COCKPIT_USER_E2E_DIR'] ?? join(process.cwd(), 'evidence/browser-cockpit-user-e2e', STAMP))

// Safety/test env: no external model, no remote writes, deterministic planner.
process.env['AEDEV_COCKPIT_FORCE_MOCK'] = '1'
process.env['AEDEV_COCKPIT_FORCE_TEMPLATE'] = '1'
process.env['AEDEV_ALLOW_REMOTE_WRITES'] = '0'
process.env['AEDEV_DISABLE_CLAUDE_CLI'] = '1'
process.env['AEDEV_DISABLE_CODEX_CLI'] = '1'
process.env['AEDEV_DISABLE_GEMINI_API'] = '1'
process.env['AEDEV_DISABLE_OPENAI_API'] = '1'

// Deterministic clarification journey: the brainstorm round asks two
// goal-specific questions at confidence 62 (locked); the follow-up round after
// the operator answers reaches confidence 96 (unlocked). This mirrors the real
// adaptive-clarify contract (fenced JSON block) without any live CLI.
const USER_PROMPT = 'Make the onboarding flow friendlier for new users. I want it to feel calmer and clearer, but I am not sure about the exact scope yet.'
const FREE_TEXT_ANSWER = 'Only the smallest slice: improve one onboarding message first.'
process.env['AEDEV_COCKPIT_PLANNER_BRAINSTORM_FIXTURE_TEXT'] = [
  'Initial brainstorm (user e2e fixture):',
  '',
  '- Your goal is promising but still broad; two answers are needed before a safe plan.',
  '- Nothing has been changed yet — this is planning only.',
  '',
  '```json',
  JSON.stringify({
    questions: [
      {
        field: 'scope',
        question: 'Which slice of the onboarding flow should this mission change first?',
        why: 'Scoping avoids an unbounded first mission.',
        impact: 'It decides the roadmap and the worker prompt.',
        destination: 'PRD/Roadmap',
        options: [{ label: 'Smallest viable slice', recommended: true }, { label: 'The whole flow' }],
      },
      {
        field: 'acceptance-criteria',
        question: 'What observable check proves this mission is done?',
        why: 'A verifiable acceptance criterion gates execution.',
        impact: 'It defines the evidence the validator reads.',
        destination: 'PRD/Roadmap',
        options: [{ label: 'A named command passes', recommended: true }, { label: 'A UI behavior visibly changes' }],
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

const stateDir = mkdtempSync(join(tmpdir(), 'aedev-cockpit-user-e2e-'))
const db = new AedevDb(':memory:')
const daemon = createServer(db, new Date(), stateDir)
let dashboard: ChildProcess | undefined
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined
const consoleIssues: string[] = []

interface StepResult {
  id: string
  title: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  screenshots: string[]
  notes: string[]
  error?: string
}
const PLANNED_STEPS: Array<[string, string]> = [
  ['step-1-compose-and-start', 'Type a user prompt into the composer and start brainstorm'],
  ['step-2-visible-progress', 'Planning shows visible progress; the UI never looks frozen'],
  ['step-3-clarifications', 'Answer the clarification popup through the real UI controls'],
  ['step-4-generate-roadmap', 'Generate roadmap; PRD/roadmap artifacts exist and stage advances'],
  ['step-5-approve-and-execute', 'Approve roadmap, start execution; execution state appears'],
  ['step-6-loop-summary', 'cockpit-loop-summary renders with non-empty whyStoppedOrContinuing'],
  ['step-7-draft-pr-gate', 'Draft PR gate BLOCKED is calm human text; no raw codes visible'],
]
// v6-P2 — at every journey step the five-card loop surface (GR#11) must show
// the EXPECTED card type with a non-empty, log-free next_step in visible text.
const steps: StepResult[] = []
let current: StepResult | undefined
let harnessError: string | undefined

// Raw machine codes that must never appear in the VISIBLE conversation/banner
// text (data-* attributes are allowed; we check innerText, not HTML).
const FORBIDDEN_VISIBLE = [
  /REMOTE_WRITES_DISABLED/,
  /GEMINI_NOT_PASS/,
  /CLARIFY_GATE_BLOCKED/,
  /HTTP 409/,
  /(^|[^0-9A-Za-z_])409([^0-9A-Za-z_]|$)/,
]
// Calm safety phrasing (user-state.ts vocabulary + the PR-gate reassurance).
const CALM_BLOCKED_PHRASING = /等待你确认|对外发布|review not configured|安全|暂停/

void main().catch((e) => {
  console.error(e)
  process.exitCode = 1
})

async function main(): Promise<void> {
  let page: Page | undefined
  try {
    mkdirSync(OUT_DIR, { recursive: true })
    db.insertRepo({
      name: 'cockpit-user-e2e',
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
    await waitForUrl(`http://127.0.0.1:${DASHBOARD_PORT}`)
    await waitForUrl(`http://127.0.0.1:${DASHBOARD_PORT}/api/operator/sessions`)

    browser = await chromium.launch()
    page = await browser.newPage({ viewport: { width: 1280, height: 900 } })
    page.on('console', (msg) => {
      if (msg.type() === 'error' || msg.type() === 'warning') consoleIssues.push(`${msg.type()}: ${msg.text()}`)
    })

    await runJourney(page)
  } catch (e) {
    console.error('[user-e2e] FAIL:', e)
    if (current) {
      current.status = 'FAIL'
      current.error = (e as Error).message
      if (page) await shot(page, `${current.id}-FAIL`).catch(() => undefined)
    } else {
      harnessError = (e as Error).message
    }
    process.exitCode = 1
  } finally {
    writeReport()
    await browser?.close().catch(() => undefined)
    if (dashboard?.pid) {
      try { process.kill(-dashboard.pid, 'SIGTERM') } catch { dashboard.kill('SIGTERM') }
    }
    await daemon.close().catch(() => undefined)
    db.close()
    rmSync(stateDir, { recursive: true, force: true })
  }
}

async function runJourney(page: Page): Promise<void> {
  // ---- Step 1 — compose a goal and start the brainstorm -------------------
  await step('step-1-compose-and-start', 'Type a user prompt into the composer and start brainstorm', async () => {
    await page.goto(`http://127.0.0.1:${DASHBOARD_PORT}`, { waitUntil: 'domcontentloaded' })
    await page.getByTestId('cockpit-goal-input').waitFor({ timeout: 15_000 })
    await page.getByTestId('cockpit-title-input').fill('User journey E2E mission')
    await page.getByTestId('cockpit-goal-input').fill(USER_PROMPT)
    note(`composer testid: cockpit-goal-input · prompt: ${USER_PROMPT.slice(0, 60)}…`)
    await page.getByTestId('cockpit-start-brainstorm').click()
    // The operator's own words must land in the transcript as a user turn.
    await page.getByText('Make the onboarding flow friendlier', { exact: false }).first().waitFor({ timeout: 15_000 })
    await shot(page, '01-composed-and-started')
  })

  // ---- Step 2 — visible progress while planning ----------------------------
  await step('step-2-visible-progress', 'Planning shows visible progress; the UI never looks frozen', async () => {
    // The "planning is running" placeholder is visible immediately…
    await page.getByText('Brainstorm is running on the local planner CLI', { exact: false }).first().waitFor({ timeout: 15_000 })
    const stripA = await page.getByTestId('cockpit-status-strip').innerText()
    const stageLabel = await page.getByTestId('mission-stage').innerText()
    if (!stageLabel.trim()) throw new Error('Status strip stage label is empty during planning')
    if (!/Brainstorm|共创|Decision|做选择|Clarify|确认|Working|正在/i.test(stripA + stageLabel)) {
      throw new Error(`Status strip does not show a planning/understanding-ish state: ${stripA}`)
    }
    note(`status strip during planning: ${oneLine(stripA)}`)
    // …and WITHOUT any further clicks the planner's brainstorm result must
    // arrive in the conversation (polling keeps the UI alive, not frozen).
    await page.getByText('Initial brainstorm (user e2e fixture)', { exact: false }).first().waitFor({ timeout: 20_000 })
    // v6-P2: while the system is still understanding/clarifying, the loop card
    // is the understanding card and its next_step is readable without logs.
    await expectLoopCard(page, ['understanding'], 'during planning/clarify')
    const stripB = await page.getByTestId('cockpit-status-strip').innerText()
    if (stripA === stripB) {
      // The strip may legitimately settle fast; the brainstorm arrival above
      // already proves the screen refreshed. Record it for the report.
      note('strip text identical across samples; liveliness proven by auto-arriving brainstorm message')
    } else {
      note(`strip refreshed: "${oneLine(stripA)}" → "${oneLine(stripB)}"`)
    }
    note('cockpit-last-activity refresh check is completed as soon as the mission overview exists (see step 4 notes) — the testid only renders once a mission is created.')
    await shot(page, '02-planning-progress')
  })

  // ---- Step 3 — clarification popup: answer through the real UI -----------
  await step('step-3-clarifications', 'Answer the clarification popup through the real UI controls', async () => {
    const popup = page.locator('.ck-clar-popup')
    await popup.waitFor({ timeout: 20_000 })
    const questions = popup.locator('.ck-clar-q')
    const count = await questions.count()
    if (count < 1) throw new Error('Clarification popup rendered with no questions')
    note(`clarification questions rendered: ${count}`)
    // Question 1: type a free-text reply (the "…or reply directly" input).
    await questions.nth(0).locator('input.ck-clar-free').fill(FREE_TEXT_ANSWER)
    // Remaining questions: pick the recommended chip like a real operator.
    for (let i = 1; i < count; i++) {
      const recommended = questions.nth(i).locator('.ck-chip.recommended')
      if (await recommended.count()) await recommended.first().click()
      else await questions.nth(i).locator('.ck-chip').first().click()
    }
    await shot(page, '03a-clarify-popup-filled')
    await popup.getByRole('button', { name: /Answer all/ }).click()
    // The answered transcript turn must appear and the popup must close.
    await page.getByText('已确认 · Clarifications', { exact: false }).first().waitFor({ timeout: 15_000 })
    await page.getByText(FREE_TEXT_ANSWER, { exact: false }).first().waitFor({ timeout: 15_000 })
    await popup.waitFor({ state: 'detached', timeout: 15_000 })
    note('answered transcript message visible; popup dismissed')

    // While the confidence gate is still locked, Generate Plan must refuse with
    // HUMAN guidance — never a raw CLARIFY_GATE_BLOCKED / 409 in visible text.
    await page.getByTestId('cockpit-generate-plan-primary').click()
    await page.locator('.ck-banner.notice', { hasText: /还有几个问题|A few questions/ }).waitFor({ timeout: 15_000 })
    await assertNoForbiddenVisibleText(page, 'after locked Generate Plan attempt')
    note('locked Generate Plan produced calm guidance, no raw gate code in visible text')
    await shot(page, '03b-clarify-answered-gate-guidance')

    // Ask the planner to re-check confidence with the answers folded in.
    await page.getByRole('button', { name: /Ask Until Clear/ }).click()
    await page.getByText('your answers are enough to plan safely', { exact: false }).first().waitFor({ timeout: 20_000 })
    note('follow-up round confirmed confidence ≥95; plan unlocked')
    // v6-P2: still pre-plan — the loop card stays the understanding card.
    await expectLoopCard(page, ['understanding'], 'after clarification answers')
    await shot(page, '03c-clarify-unlocked')
  })

  // ---- Step 4 — generate the roadmap ---------------------------------------
  await step('step-4-generate-roadmap', 'Generate roadmap; PRD/roadmap artifacts exist and stage advances', async () => {
    await page.getByTestId('cockpit-generate-plan-primary').click()
    await page.getByTestId('cockpit-approve-roadmap').waitFor({ timeout: 20_000 })
    await page.getByText('Generated AI-backed PRD', { exact: false }).first().waitFor({ timeout: 15_000 })
    const mission = db.listMissions()[0]
    if (!mission) throw new Error('No mission was created by generate-roadmap')
    const artifacts = db.listMissionArtifacts(mission.id)
    if (artifacts.length === 0) throw new Error('No roadmap/PRD artifacts registered for the mission')
    note(`mission ${mission.id} created with ${artifacts.length} design artifacts (${artifacts.slice(0, 3).map((a) => a.type).join(', ')}…)`)
    await expectStage(page, ['roadmap_ready', 'pending_approval'])
    // v6-P2: at roadmap_ready the daemon-derived card is the plan card.
    await expectLoopCard(page, ['plan'], 'at roadmap_ready')
    // overnight-p3: the plan card carries its own next-step action button.
    await expectCardAction(page, ['generate-plan', 'approve-roadmap'], 'on the plan card')

    // Deferred half of step 2: the overview now exists, so cockpit-last-activity
    // must render and keep refreshing (two samples >1.5s apart).
    await page.getByTestId('cockpit-last-activity').waitFor({ timeout: 20_000 })
    const sampleA = await page.getByTestId('cockpit-last-activity').innerText()
    await page.waitForTimeout(1_700)
    const sampleB = await page.getByTestId('cockpit-last-activity').innerText()
    const small = (t: string) => { const m = t.match(/(\d+)s ago/); return m?.[1] !== undefined && Number(m[1]) <= 90 }
    if (sampleA === sampleB && !(small(sampleA) && small(sampleB))) {
      throw new Error(`cockpit-last-activity looks frozen: "${oneLine(sampleA)}" vs "${oneLine(sampleB)}"`)
    }
    const step2 = steps.find((s) => s.id === 'step-2-visible-progress')
    step2?.notes.push(`cockpit-last-activity refresh verified: "${oneLine(sampleA)}" → "${oneLine(sampleB)}" (1.7s apart)`)
    note(`cockpit-last-activity refresh verified: "${oneLine(sampleA)}" → "${oneLine(sampleB)}"`)
    await shot(page, '04-roadmap-ready')
  })

  // ---- Step 5 — approve, then start execution -------------------------------
  await step('step-5-approve-and-execute', 'Approve roadmap, start execution; execution state appears', async () => {
    await page.getByTestId('cockpit-approve-roadmap').click()
    await page.getByTestId('cockpit-start-execution').waitFor({ timeout: 20_000 })
    // overnight-p3: after approval the card's own action button offers Start.
    await expectCardAction(page, ['start-execution'], 'on the approved card')
    await shot(page, '05a-approved')
    await page.getByTestId('cockpit-start-execution').click()
    await waitForRootStage(page, ['running', 'evidence_ready', 'validators_missing', 'validating', 'pr_ready'], 30_000)
    note(`execution state appeared (stage=${await rootStage(page)})`)
    // v6-P2: during execution/checking the loop card is the progress card.
    await expectLoopCard(page, ['progress'], 'during execution')
    await waitForRootStage(page, ['evidence_ready', 'validators_missing', 'validators_ready', 'pr_ready'], 60_000)
    const mission = db.listMissions()[0]
    if (!mission) throw new Error('Mission disappeared')
    const overview = await fetchOverview(mission.id)
    if (!Array.isArray(overview.runs) || overview.runs.length < 1) throw new Error('No worker run recorded after execution started')
    note(`worker runs recorded: ${overview.runs.length}; final stage=${await rootStage(page)}`)
    await page.getByTestId('cockpit-check-draft-pr-gate').waitFor({ timeout: 15_000 })
    await assertNoForbiddenVisibleText(page, 'after execution reached the evidence gate')
    await shot(page, '05b-execution-evidence-gate')
  })

  // ---- Step 6 — evidence visibility: loop summary ---------------------------
  await step('step-6-loop-summary', 'cockpit-loop-summary renders with non-empty whyStoppedOrContinuing', async () => {
    await page.getByTestId('cockpit-loop-summary').waitFor({ timeout: 20_000 })
    const why = await page.evaluate(() => {
      const card = document.querySelector('[data-testid="cockpit-loop-summary"]')
      if (!card) return ''
      for (const row of Array.from(card.querySelectorAll('dl > div'))) {
        if (row.querySelector('dt')?.textContent?.trim() === 'Why') return row.querySelector('dd')?.textContent?.trim() ?? ''
      }
      return ''
    })
    if (!why || why.length < 8 || why === '—') throw new Error(`loop summary "Why" text is empty/placeholder: "${why}"`)
    note(`whyStoppedOrContinuing: ${oneLine(why)}`)
    await shot(page, '06-loop-summary')
  })

  // ---- Step 7 — Draft PR gate: human-readable BLOCKED, no raw codes ---------
  await step('step-7-draft-pr-gate', 'Draft PR gate BLOCKED is calm human text; no raw codes visible', async () => {
    await page.getByTestId('cockpit-check-draft-pr-gate').click()
    await page.getByTestId('cockpit-pr-gate-card').waitFor({ timeout: 20_000 })
    const cardStatus = await page.getByTestId('cockpit-pr-gate-card').getAttribute('data-pr-gate-status')
    if (cardStatus !== 'blocked') throw new Error(`Expected blocked PR gate card, got ${cardStatus}`)
    const gateCode = await page.getByTestId('cockpit-root').getAttribute('data-pr-gate-code')
    note(`machine code stays in data-* only: data-pr-gate-code=${gateCode}`)
    const bodyText = await page.evaluate(() => document.body.innerText)
    if (!CALM_BLOCKED_PHRASING.test(bodyText)) {
      throw new Error('BLOCKED state lacks the calm safety phrasing (等待你确认/对外发布/review not configured/安全/暂停)')
    }
    note('calm safety phrasing visible (安全门 / no push, no PR, no merge reassurance)')
    await assertNoForbiddenVisibleText(page, 'on the blocked Draft PR gate screen')
    // v6-P2: at the gate the loop card is blocker (or pr_ready when a real PR
    // exists); with remote writes disabled the safe expectation is blocker.
    await expectLoopCard(page, ['blocker', 'pr_ready'], 'at the Draft PR gate')
    const mission = db.listMissions()[0]
    if (mission?.githubPrUrl) throw new Error(`Unexpected PR URL recorded: ${mission.githubPrUrl}`)
    if (!db.queryEvents({ entityId: mission!.id, limit: 20 }).some((e) => e.type === 'operator.draft_pr_blocked')) {
      throw new Error('Missing operator.draft_pr_blocked event')
    }
    note('no PR URL recorded; operator.draft_pr_blocked event present')
    await shot(page, '07-pr-gate-blocked-human')
  })
}

async function step(id: string, title: string, fn: () => Promise<void>): Promise<void> {
  current = { id, title, status: 'PASS', screenshots: [], notes: [] }
  steps.push(current)
  console.log(`[user-e2e] ${id} — ${title}`)
  await fn()
  current = undefined
}

function note(text: string): void {
  current?.notes.push(text)
}

async function shot(page: Page, name: string): Promise<void> {
  const file = join(OUT_DIR, `${name}.png`)
  await page.screenshot({ path: file, fullPage: true })
  current?.screenshots.push(file)
}

async function assertNoForbiddenVisibleText(page: Page, where: string): Promise<void> {
  const bodyText = await page.evaluate(() => document.body.innerText)
  for (const re of FORBIDDEN_VISIBLE) {
    if (re.test(bodyText)) {
      const around = bodyText.match(new RegExp(`.{0,60}${re.source}.{0,60}`))?.[0] ?? ''
      throw new Error(`Raw machine code ${re} leaked into visible text ${where}: …${oneLine(around)}…`)
    }
  }
}

/**
 * v6-P2 (GR#11) — assert that the loop card is present with one of the
 * expected card types, that an ordinary user can read a non-empty next_step
 * in visible text (no logs needed), and that the card's machine codes stay in
 * data-* attributes only — never inside its visible text.
 */
async function expectLoopCard(page: Page, expectedTypes: string[], where: string, timeoutMs = 20_000): Promise<void> {
  const card = page.getByTestId('cockpit-loop-card')
  const deadline = Date.now() + timeoutMs
  let lastType = 'absent'
  while (Date.now() < deadline) {
    if (await card.count()) {
      lastType = (await card.getAttribute('data-card-type')) ?? 'unknown'
      if (expectedTypes.includes(lastType)) break
    }
    await page.waitForTimeout(200)
  }
  if (!expectedTypes.includes(lastType)) {
    throw new Error(`Expected loop card type in [${expectedTypes.join(', ')}] ${where}, got: ${lastType}`)
  }
  const nextStep = oneLine(await page.getByTestId('cockpit-loop-card-next-step').innerText())
  const nextStepBody = nextStep.replace(/下一步 · Next/g, '').trim()
  if (nextStepBody.length < 8) {
    throw new Error(`Loop card next_step is empty/too short ${where}: "${nextStep}"`)
  }
  const cardText = await card.innerText()
  for (const re of FORBIDDEN_VISIBLE) {
    if (re.test(cardText)) throw new Error(`Raw machine code ${re} leaked into the loop card ${where}`)
  }
  for (const attr of ['data-hold-code', 'data-pr-gate-code', 'data-machine-stage'] as const) {
    const code = await card.getAttribute(attr)
    // Stage tokens that are plain words (e.g. "running") can legitimately occur
    // in calm prose; only machine-looking tokens (underscored / HOLD-*) are
    // forbidden from visible text.
    const machineLooking = Boolean(code) && (code!.includes('_') || code!.startsWith('HOLD-'))
    if (code && machineLooking && cardText.includes(code)) {
      throw new Error(`Machine code "${code}" (${attr}) rendered as visible loop-card text ${where}`)
    }
  }
  // overnight-p3 — every card carries the agent strip: a new user sees WHO is
  // working (Claude/Codex/Gemini/GitHub) without reading logs.
  const agents = page.getByTestId('cockpit-card-agents')
  if (!(await agents.count())) throw new Error(`Agent strip (cockpit-card-agents) missing on the loop card ${where}`)
  const activeAgent = (await agents.getAttribute('data-active-agent')) ?? 'absent'
  const agentsText = await agents.innerText()
  for (const name of ['Claude', 'Codex', 'Gemini', 'GitHub']) {
    if (!agentsText.includes(name)) throw new Error(`Agent strip is missing "${name}" ${where}`)
  }
  note(`loop card ${where}: type=${lastType} · active-agent=${activeAgent} · next_step="${nextStepBody.slice(0, 120)}"`)
}

/**
 * overnight-p3 — the card's next-step action button (cockpit-card-action):
 * the daemon primaryAction is rendered ON the card, so the operator can act
 * from the card itself without hunting for the guidance row.
 */
async function expectCardAction(page: Page, expectedActionIds: string[], where: string): Promise<void> {
  const btn = page.getByTestId('cockpit-card-action')
  await btn.waitFor({ timeout: 15_000 })
  const actionId = (await btn.getAttribute('data-action-id')) ?? 'absent'
  if (!expectedActionIds.includes(actionId)) {
    throw new Error(`Expected card action in [${expectedActionIds.join(', ')}] ${where}, got: ${actionId}`)
  }
  const label = oneLine(await btn.innerText())
  if (label.length < 4) throw new Error(`Card action button has no readable label ${where}`)
  note(`card action ${where}: ${actionId} · "${label}"`)
}

async function rootStage(page: Page): Promise<string> {
  return (await page.getByTestId('cockpit-root').getAttribute('data-stage')) ?? 'unknown'
}

async function expectStage(page: Page, stages: string[]): Promise<void> {
  const stage = await rootStage(page)
  if (!stages.includes(stage)) throw new Error(`Expected stage in [${stages.join(', ')}], got ${stage}`)
}

async function waitForRootStage(page: Page, stages: string[], timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const stage = await rootStage(page)
    if (stages.includes(stage)) return
    await page.waitForTimeout(200)
  }
  throw new Error(`Timed out waiting for root stage in ${stages.join(', ')} (last: ${await rootStage(page)})`)
}

async function fetchOverview(missionId: string): Promise<{ runs?: unknown[] }> {
  const res = await fetch(`http://127.0.0.1:${DAEMON_PORT}/missions/${missionId}/overview`)
  if (!res.ok) throw new Error(`overview fetch failed: HTTP ${res.status}`)
  return res.json() as Promise<{ runs?: unknown[] }>
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, ' ').trim().slice(0, 160)
}

async function waitForUrl(url: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (res.ok) return
    } catch {
      // retry
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`Timed out waiting for ${url}`)
}

function writeReport(): void {
  for (const [id, title] of PLANNED_STEPS) {
    if (!steps.some((s) => s.id === id)) {
      steps.push({ id, title, status: 'SKIP', screenshots: [], notes: ['skipped after an earlier failure'] })
    }
  }
  steps.sort((a, b) => PLANNED_STEPS.findIndex(([id]) => id === a.id) - PLANNED_STEPS.findIndex(([id]) => id === b.id))
  const executed = steps.filter((s) => s.status !== 'SKIP')
  const failed = steps.filter((s) => s.status === 'FAIL')
  const overall = failed.length === 0 && executed.length === PLANNED_STEPS.length ? 'PASS' : 'FAIL'
  if (overall === 'FAIL') process.exitCode = 1
  const lines: string[] = [
    '# Operator Cockpit — User Journey E2E Report',
    '',
    `Result: **${overall}**`,
    `Timestamp: ${STAMP}`,
    `Evidence dir: ${OUT_DIR}`,
    ...(harnessError ? ['', `Harness error (before/around the journey): ${harnessError}`] : []),
    '',
    'Harness: mock/template planner+worker, remote writes disabled, all external CLIs/APIs disabled,',
    'temp stateDir, in-memory SQLite, vite dashboard, chromium via playwright.',
    '',
    '## Steps',
    '',
  ]
  for (const s of steps) {
    lines.push(`### ${s.id} — ${s.status}`)
    lines.push('')
    lines.push(s.title)
    for (const n of s.notes) lines.push(`- ${n}`)
    if (s.error) lines.push(`- ERROR: ${s.error}`)
    for (const file of s.screenshots) lines.push(`- screenshot: ${file}`)
    lines.push('')
  }
  if (executed.length < PLANNED_STEPS.length) {
    lines.push(`> Only ${executed.length}/${PLANNED_STEPS.length} journey steps executed; the remainder were skipped after a failure.`, '')
  }
  lines.push('## Browser console issues (informational)', '')
  lines.push(consoleIssues.length ? consoleIssues.map((c) => `- ${c}`).join('\n') : '- none')
  lines.push('', '> Note: the deliberate locked Generate Plan probe in step 3 produces one expected 409 network log entry;',
    '> the assertion is that the VISIBLE UI stays human (guidance text, no raw codes).', '')
  writeFileSync(join(OUT_DIR, 'user-e2e-report.md'), lines.join('\n'))
  writeFileSync(join(OUT_DIR, 'console-logs.json'), JSON.stringify(consoleIssues, null, 2))
  console.log(`Operator Cockpit user journey E2E ${overall} — evidence in ${OUT_DIR}`)
}
