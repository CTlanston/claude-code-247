/**
 * V6-P4 — minimal safe recursive planner (WORKBOOK_v6 §3).
 *
 * PURE decision logic only. `planNextCycle` reads pre-gathered facts about
 * the repo and proposes exactly ONE next cycle, or refuses with a human
 * recovery action. All shell probing (git status, workbook reads, budget DB)
 * lives in `scripts/loop-planner.ts` — GR#8 keeps child_process out of
 * daemon src, and the static eslint guard enforces it.
 *
 * Hard guardrails (each refusal has its own unit test):
 *   dirty working tree / red tests / blocked budget / ambiguous SoT /
 *   open holds / previous cycle PR not merged / unparseable §0 / no gaps.
 *
 * The planner NEVER implements, never pushes, never merges. Its output is a
 * proposal; the produced work of an accepted cycle stops at a Draft PR
 * (GR#10 — human merge only). Cycle ledger entries are written to
 * `evidence/loop-cycles/cycle-<n>.json` AND event-sourced as
 * `planner.cycle_planned` so the ledger rebuilds from events alone (GR#5).
 */
import { mkdirSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { AedevDb } from '@aedev/core'

// ---- types -------------------------------------------------------------------

export type GapCategory = 'safety_evidence' | 'user_ux' | 'automation' | 'fleet' | 'polish'

/** Fixed v6 priority — 安全证据 > 普通用户 UX > 自动化 > fleet 规模 > 打磨. */
export const GAP_PRIORITY: readonly GapCategory[] = [
  'safety_evidence',
  'user_ux',
  'automation',
  'fleet',
  'polish',
] as const

export interface PhaseGap {
  id: string
  phase: string
  description: string
  category: GapCategory
}

export interface PlannerInput {
  /** Raw text of WORKBOOK_v6 §0 (the machine-readable yaml block). */
  workbookSection0: string
  repoDirty: boolean
  testsGreen: boolean
  budgetVerdict: { allowed: boolean; reason: string }
  /** True when ≠1 root workbook claims to be the source of truth. */
  sotAmbiguous: boolean
  openHolds: number
  /** False while the previous proposed cycle's PR is still unmerged. */
  prevCyclePrMerged: boolean
  phaseGaps: PhaseGap[]
}

export type PlanDecision =
  | { action: 'refuse'; reason: string; recovery: string }
  | {
      action: 'propose'
      cycle: { gapId: string; phase: string; rationale: string; expectedDeliverable: string }
    }

// ---- §0 parsing ---------------------------------------------------------------

export interface Section0State {
  currentPhase: string
  openHolds: number | null
  mergePolicy: string | null
}

/** Minimal, dependency-free parse of the §0 yaml block. Returns null when the
 *  block has no `current_phase` — an unparseable SoT means the planner must
 *  not guess what phase it is in. */
export function parseSection0(raw: string): Section0State | null {
  const field = (name: string): string | null => {
    const m = raw.match(new RegExp(`^${name}:\\s*([^\\n#]+)`, 'm'))
    return m?.[1] === undefined ? null : m[1].trim()
  }
  const currentPhase = field('current_phase')
  if (currentPhase === null || currentPhase === '') return null
  const holdsRaw = field('open_holds')
  const holds = holdsRaw === null ? NaN : Number(holdsRaw)
  return {
    currentPhase,
    openHolds: Number.isFinite(holds) ? holds : null,
    mergePolicy: field('merge_policy'),
  }
}

// ---- SoT claim detection (pure; the shell reads the files) --------------------

const SOT_CLAIM_RE = /本文件是.{0,8}唯一事实源|this file is the .{0,12}source of truth/i
const SUPERSEDED_HEADER_RE = /^>.{0,12}\*\*SUPERSEDED/im

/** A workbook claims SoT when it carries a live claim line and no SUPERSEDED
 *  banner. (The live v6 workbook may MENTION the word "SUPERSEDED" while
 *  describing v4's banner — only a `> **SUPERSEDED` header line disqualifies.) */
export function claimsSourceOfTruth(text: string): boolean {
  return SOT_CLAIM_RE.test(text) && !SUPERSEDED_HEADER_RE.test(text)
}

export function detectSotAmbiguity(
  workbooks: Array<{ name: string; text: string }>,
): { ambiguous: boolean; claimants: string[] } {
  const claimants = workbooks.filter((w) => claimsSourceOfTruth(w.text)).map((w) => w.name)
  return { ambiguous: claimants.length !== 1, claimants }
}

// ---- the decision -------------------------------------------------------------

const refuse = (reason: string, recovery: string): PlanDecision => ({ action: 'refuse', reason, recovery })

export function planNextCycle(input: PlannerInput): PlanDecision {
  if (input.repoDirty) {
    return refuse(
      'Working tree is dirty — the planner refuses to plan on top of uncommitted state.',
      'Human: review `git status`, then commit or stash the changes before re-running loop:plan.',
    )
  }
  if (!input.testsGreen) {
    return refuse(
      'Test suite is not green — planning forward on a red baseline would bury the regression.',
      'Human: run `GIT_CONFIG_GLOBAL=/tmp/test-gitconfig pnpm test`, fix the failures (or hold the offending change), then re-run loop:plan.',
    )
  }
  if (!input.budgetVerdict.allowed) {
    return refuse(
      `Headless budget blocked (${input.budgetVerdict.reason}) — a planner cycle would spend Agent SDK credit past the cap (GR#1).`,
      'Human: wait for the daily window, or raise AEDEV_BUDGET_MAX_HEADLESS_PER_MISSION / AEDEV_BUDGET_MAX_HEADLESS_PER_DAY deliberately, then re-run loop:plan.',
    )
  }
  if (input.sotAmbiguous) {
    return refuse(
      'Source-of-truth is ambiguous — not exactly one root workbook claims to be the current SoT.',
      'Human: keep exactly one live SoT claim; add a `> **SUPERSEDED` banner to every other root workbook, then re-run loop:plan.',
    )
  }
  if (input.openHolds > 0) {
    return refuse(
      `${input.openHolds} open hold(s) — holds are owed to a human before any new cycle starts.`,
      'Human: resolve the active holds (`aedev status`, ~/.aedev/logs/holds.md), then re-run loop:plan.',
    )
  }
  if (!input.prevCyclePrMerged) {
    return refuse(
      'The previous cycle\'s PR is not merged — at most one planner cycle may be in flight (GR#10: merge is human-only).',
      'Human: merge or close the previous cycle\'s PR (your decision, never the system\'s), then re-run loop:plan.',
    )
  }
  const section0 = parseSection0(input.workbookSection0)
  if (section0 === null) {
    return refuse(
      'WORKBOOK §0 (section 0) is unparseable — the planner cannot know the current phase, which is SoT ambiguity.',
      'Human: restore the machine-readable §0 yaml block in WORKBOOK_v6.md (current_phase et al.), then re-run loop:plan.',
    )
  }
  if (input.phaseGaps.length === 0) {
    return refuse(
      'No known gap to work on — proposing busywork would violate evidence honesty (GR#7).',
      'Human: update the gap registry from the WORKBOOK phase table / assessment before re-running loop:plan.',
    )
  }

  // Exactly ONE pick: strict category priority, ties broken by stable order.
  const rank = (g: PhaseGap): number => GAP_PRIORITY.indexOf(g.category)
  let chosen = input.phaseGaps[0]!
  for (const gap of input.phaseGaps) {
    if (rank(gap) < rank(chosen)) chosen = gap
  }

  return {
    action: 'propose',
    cycle: {
      gapId: chosen.id,
      phase: chosen.phase,
      rationale:
        `Highest-priority open gap by the fixed v6 order (${GAP_PRIORITY.join(' > ')}): ` +
        `category=${chosen.category}, phase=${chosen.phase}, workbook current_phase=${section0.currentPhase}.`,
      expectedDeliverable:
        `One bounded cycle toward: ${chosen.description}. ` +
        'Output stops at evidence + at most a Draft PR — the system never merges (GR#10).',
    },
  }
}

// ---- cycle ledger ---------------------------------------------------------------

export const CYCLE_PLANNED_EVENT = 'planner.cycle_planned'

export interface CycleLedgerEntry {
  cycle: number
  decision: PlanDecision
  timestamp: string
  workbook_phase: string
  chosen_gap: string | null
}

export interface AppendCycleLedgerOptions {
  /** Directory of the ledger, normally `<repo>/evidence/loop-cycles`. */
  dir: string
  decision: PlanDecision
  workbookPhase: string
  /** When given, the entry is ALSO event-sourced (GR#5). */
  db?: AedevDb
  now?: Date
}

const CYCLE_FILE_RE = /^cycle-(\d+)\.json$/

/** Append `cycle-<n>.json` (n = previous max + 1) and optionally event-source
 *  the same payload so `rebuildCycleLedgerFromEvents` can reproduce the
 *  on-disk ledger byte-for-byte at the JSON level. */
export function appendCycleLedger(opts: AppendCycleLedgerOptions): CycleLedgerEntry & { path: string } {
  mkdirSync(opts.dir, { recursive: true })
  const existing = readdirSync(opts.dir)
    .map((f) => CYCLE_FILE_RE.exec(f)?.[1])
    .filter((n): n is string => n !== undefined)
    .map((n) => Number(n))
  const cycle = existing.length === 0 ? 1 : Math.max(...existing) + 1
  const entry: CycleLedgerEntry = {
    cycle,
    decision: opts.decision,
    timestamp: (opts.now ?? new Date()).toISOString(),
    workbook_phase: opts.workbookPhase,
    chosen_gap: opts.decision.action === 'propose' ? opts.decision.cycle.gapId : null,
  }
  const path = join(opts.dir, `cycle-${cycle}.json`)
  writeFileSync(path, `${JSON.stringify(entry, null, 2)}\n`)
  opts.db?.insertEvent(CYCLE_PLANNED_EVENT, 'planner_cycle', `cycle-${cycle}`, { ...entry })
  return { ...entry, path }
}

/** GR#5 — the ledger must be reconstructable from events alone. */
export function rebuildCycleLedgerFromEvents(db: AedevDb): CycleLedgerEntry[] {
  return db
    .queryEvents({ type: CYCLE_PLANNED_EVENT })
    .map((e) => e.payload as unknown as CycleLedgerEntry)
    .sort((a, b) => a.cycle - b.cycle)
}
