/**
 * V6-P4 — loop-planner CLI shell (`pnpm loop:plan`).
 *
 * Gathers REAL inputs (git status, WORKBOOK_v6 §0, root SoT claims, headless
 * budget from ~/.aedev/state.db when present, open holds, previous-cycle
 * ledger) and asks the pure `planNextCycle` (packages/daemon, GR#8: all
 * shell/git probing lives HERE, not in daemon src) for exactly one decision.
 *
 * It then prints the decision as a PlanCard-shaped JSON + human text and
 * appends `evidence/loop-cycles/cycle-<n>.json`. IT STOPS THERE: this shell
 * never implements, never pushes, never opens a PR — a human (or a human-
 * started session) acts on the proposal, and merge is human-only (GR#10).
 *
 * Knobs (all honest-by-default):
 *   AEDEV_LOOP_TESTS_GREEN=1|0   assert the suite state instead of running
 *                                `pnpm test` (the run notes the assertion)
 *   AEDEV_LOOP_PREV_PR_MERGED=1  operator-asserts the previous cycle's PR
 *                                was merged/closed (only needed once a
 *                                previous proposal exists in the ledger)
 *   AEDEV_HOME                   where state.db lives (default ~/.aedev)
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { AedevDb } from '@aedev/core'
import {
  appendCycleLedger,
  checkHeadlessBudget,
  detectSotAmbiguity,
  parseSection0,
  planNextCycle,
  type CycleLedgerEntry,
  type PhaseGap,
  type PlanDecision,
} from '@aedev/daemon'

const REPO_ROOT = resolve(process.cwd())
const LEDGER_DIR = join(REPO_ROOT, 'evidence', 'loop-cycles')
const WORKBOOK = join(REPO_ROOT, 'WORKBOOK_v6.md')

/** Hand-maintained mirror of the open gaps in WORKBOOK_v6 §3 + the gap
 *  assessment §2. Honesty note: this registry is data, not discovery — when a
 *  phase closes, remove its gap here in the same PR that closes it. */
const GAP_REGISTRY: PhaseGap[] = [
  {
    id: 'v6-p3-real-proof-closeout',
    phase: 'V6-P3',
    category: 'safety_evidence',
    description:
      'Operator-gated real-proof closeout: real Draft PR URL + real in-repo Gemini verdict artifact '
      + '(operator Mac, runbook docs/operations/P4-first-real-draft-pr.md)',
  },
  {
    id: 'v6-p6-ordinary-user-acceptance',
    phase: 'V6-P6',
    category: 'user_ux',
    description: 'Ordinary-user acceptance: usability E2E across the five cards + final scored report in docs/assessments/',
  },
  {
    id: 'v6-p5-one-week-real-soak',
    phase: 'V6-P5',
    category: 'automation',
    description: 'Run the one-week unattended soak per docs/operations/SOAK_OPERATIONS.md and land its evidence in-repo',
  },
  {
    id: 'v5-byo-fleet-real-machines',
    phase: 'parked-v5',
    category: 'fleet',
    description: 'Real multi-machine BYO fleet (parked by WORKBOOK_v6 §6; inherits the v5 hard rules)',
  },
  {
    id: 'post-acceptance-docs-polish',
    phase: 'V6-P6',
    category: 'polish',
    description: 'README/docs polish after the ordinary-user acceptance lands',
  },
]

interface GatherNote { fact: string; value: string; how: string }
const notes: GatherNote[] = []
const note = (fact: string, value: string, how: string): void => { notes.push({ fact, value, how }) }

// ---- 1. git status --------------------------------------------------------
const porcelain = execFileSync('git', ['status', '--porcelain'], { cwd: REPO_ROOT, encoding: 'utf8' }).trim()
const repoDirty = porcelain.length > 0
note('repoDirty', String(repoDirty), repoDirty ? `git status --porcelain → ${porcelain.split('\n').length} entr(ies)` : 'git status --porcelain → empty')

// ---- 2. WORKBOOK §0 --------------------------------------------------------
const workbookText = existsSync(WORKBOOK) ? readFileSync(WORKBOOK, 'utf8') : ''
const section0Match = workbookText.match(/## §0[^\n]*\n+```yaml\n([\s\S]*?)```/)
const workbookSection0 = section0Match?.[1] ?? ''
const section0 = parseSection0(workbookSection0)
note('workbook §0', section0 ? `current_phase=${section0.currentPhase}` : 'UNPARSEABLE', `extracted yaml block from ${WORKBOOK}`)

// ---- 3. SoT ambiguity -------------------------------------------------------
const rootWorkbooks = readdirSync(REPO_ROOT)
  .filter((f) => /^WORKBOOK.*\.md$/.test(f))
  .map((name) => ({ name, text: readFileSync(join(REPO_ROOT, name), 'utf8') }))
const sot = detectSotAmbiguity(rootWorkbooks)
note('sotAmbiguous', String(sot.ambiguous), `root workbooks scanned: ${rootWorkbooks.map((w) => w.name).join(', ')} · live SoT claimants: ${sot.claimants.join(', ') || '(none)'}`)

// ---- 4. tests ----------------------------------------------------------------
let testsGreen: boolean
const assertedTests = process.env['AEDEV_LOOP_TESTS_GREEN']
if (assertedTests === '1' || assertedTests === '0') {
  testsGreen = assertedTests === '1'
  note('testsGreen', String(testsGreen), 'operator-asserted via AEDEV_LOOP_TESTS_GREEN (not verified by this run)')
} else {
  console.log('[loop-planner] running the full test suite (set AEDEV_LOOP_TESTS_GREEN=1|0 to assert instead)…')
  try {
    execFileSync('pnpm', ['test'], { cwd: REPO_ROOT, stdio: ['ignore', 'ignore', 'inherit'] })
    testsGreen = true
  } catch {
    testsGreen = false
  }
  note('testsGreen', String(testsGreen), 'ran `pnpm test` in this invocation and used its exit code')
}

// ---- 5. budget + holds from ~/.aedev/state.db --------------------------------
const aedevHome = process.env['AEDEV_HOME'] ?? join(homedir(), '.aedev')
const dbPath = join(aedevHome, 'state.db')
let db: AedevDb | undefined
let budgetVerdict: { allowed: boolean; reason: string }
let dbHolds = 0
if (existsSync(dbPath)) {
  db = new AedevDb(dbPath)
  const v = checkHeadlessBudget(db, 'loop-planner')
  budgetVerdict = { allowed: v.allowed, reason: v.reason }
  dbHolds = db.listActiveHolds().length
  note('budgetVerdict', JSON.stringify(budgetVerdict), `cost.headless_call events in ${dbPath} vs env limits`)
  note('openHolds(db)', String(dbHolds), `active holds in ${dbPath}`)
} else {
  budgetVerdict = { allowed: true, reason: 'no-db' }
  note('budgetVerdict', JSON.stringify(budgetVerdict), `no ${dbPath} in this environment — nothing has spent headless credit (default-allow with no-db note)`)
}
const section0Holds = section0?.openHolds ?? 0
const openHolds = Math.max(dbHolds, section0Holds)
note('openHolds', String(openHolds), `max(state.db active holds=${dbHolds}, WORKBOOK §0 open_holds=${section0Holds})`)

// ---- 6. previous cycle -----------------------------------------------------------
let prevCyclePrMerged = true
let prevHow = 'no previous proposal in evidence/loop-cycles — first cycle'
if (existsSync(LEDGER_DIR)) {
  const prevProposals = readdirSync(LEDGER_DIR)
    .filter((f) => /^cycle-\d+\.json$/.test(f))
    .map((f) => JSON.parse(readFileSync(join(LEDGER_DIR, f), 'utf8')) as CycleLedgerEntry)
    .filter((e) => e.decision.action === 'propose')
  if (prevProposals.length > 0) {
    prevCyclePrMerged = process.env['AEDEV_LOOP_PREV_PR_MERGED'] === '1'
    prevHow = prevCyclePrMerged
      ? `${prevProposals.length} previous proposal(s); operator-asserted merged via AEDEV_LOOP_PREV_PR_MERGED=1`
      : `${prevProposals.length} previous proposal(s) in the ledger and AEDEV_LOOP_PREV_PR_MERGED is not 1 — treated as unmerged (fail-closed)`
  }
}
note('prevCyclePrMerged', String(prevCyclePrMerged), prevHow)

// ---- 7. decide -------------------------------------------------------------------
const decision: PlanDecision = planNextCycle({
  workbookSection0,
  repoDirty,
  testsGreen,
  budgetVerdict,
  sotAmbiguous: sot.ambiguous,
  openHolds,
  prevCyclePrMerged,
  phaseGaps: GAP_REGISTRY,
})

// ---- 8. ledger + output (the shell STOPS here — GR#10) ----------------------------
const entry = appendCycleLedger({
  dir: LEDGER_DIR,
  decision,
  workbookPhase: section0?.currentPhase ?? 'unknown',
  ...(db !== undefined ? { db } : {}),
})
db?.close()

const card = decision.action === 'propose'
  ? {
      type: 'plan' as const,
      title: 'Planner proposal · 递归 planner 提案',
      next_step:
        'Human decision: accept this proposal by starting a session on it, or ignore it. '
        + 'The planner stops here — it never implements, never pushes, never merges.',
      machine: { user_state: 'planner_proposal', stage: 'loop-planner', hold_code: null, pr_gate_code: null },
      objective: decision.cycle.expectedDeliverable,
      phases: [decision.cycle.phase],
      acceptance_criteria: [
        'The chosen gap moves with in-repo evidence (GR#7)',
        'Output stops at evidence + at most a Draft PR; merge stays human-only (GR#10)',
      ],
      risk_level: 'low' as const,
      estimated_calls: 0,
      requires_approval: true,
      proposal: decision.cycle,
    }
  : {
      type: 'blocker' as const,
      title: 'Planner refused · 递归 planner 拒绝规划',
      next_step: decision.recovery,
      machine: { user_state: 'planner_refused', stage: 'loop-planner', hold_code: null, pr_gate_code: null },
      human_explanation: decision.reason,
      why_it_matters: 'Planning on top of an unsafe baseline (dirty tree / red tests / blocked budget / ambiguous SoT / open holds) would burn credit and bury problems.',
      recovery_actions: [decision.recovery],
      recommended_action: decision.recovery,
    }

console.log('\n=== loop-planner inputs (real, gathered by this run) ===')
for (const n of notes) console.log(`- ${n.fact} = ${n.value}\n    via ${n.how}`)
console.log('\n=== PlanCard (decision) ===')
console.log(JSON.stringify(card, null, 2))
console.log('\n=== human text ===')
if (decision.action === 'propose') {
  console.log(`PROPOSE cycle ${entry.cycle}: gap "${decision.cycle.gapId}" (phase ${decision.cycle.phase})`)
  console.log(`  why: ${decision.cycle.rationale}`)
  console.log(`  deliverable: ${decision.cycle.expectedDeliverable}`)
} else {
  console.log(`REFUSE cycle ${entry.cycle}: ${decision.reason}`)
  console.log(`  recovery: ${decision.recovery}`)
}
console.log(`\nLedger entry written: ${entry.path}`)
console.log('loop-planner stops here. A human (or a human-started session) acts on this — never this script.')
