/**
 * V6-P4 — recursive planner unit matrix.
 *
 * L1 acceptance (WORKBOOK_v6 §3 V6-P4): every refusal condition has a unit
 * test; the planner picks exactly ONE gap by the fixed priority
 * safety_evidence > user_ux > automation > fleet > polish (ties broken by
 * stable input order); the cycle ledger is reconstructable from events (GR#5).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { AedevDb } from '@aedev/core'
import {
  CYCLE_PLANNED_EVENT,
  GAP_PRIORITY,
  appendCycleLedger,
  claimsSourceOfTruth,
  detectSotAmbiguity,
  parseSection0,
  planNextCycle,
  rebuildCycleLedgerFromEvents,
  type PhaseGap,
  type PlanDecision,
  type PlannerInput,
} from './recursive-planner.js'

const SECTION0 = [
  'schema_version: 6',
  'product: ordinary-user-loop-os',
  'current_phase: V6-P4          # V6-P0..P6',
  'open_holds: 0',
  'merge_policy: human_only',
].join('\n')

const GAPS: PhaseGap[] = [
  { id: 'g-polish', phase: 'V6-P6', description: 'polish docs wording', category: 'polish' },
  { id: 'g-fleet', phase: 'parked-v5', description: 'real multi-machine fleet', category: 'fleet' },
  { id: 'g-auto', phase: 'V6-P5', description: 'run the one-week real soak', category: 'automation' },
  { id: 'g-ux', phase: 'V6-P6', description: 'ordinary-user acceptance run', category: 'user_ux' },
  { id: 'g-safety', phase: 'V6-P3', description: 'real Draft PR + real Gemini verdict evidence in-repo', category: 'safety_evidence' },
]

function baseInput(overrides: Partial<PlannerInput> = {}): PlannerInput {
  return {
    workbookSection0: SECTION0,
    repoDirty: false,
    testsGreen: true,
    budgetVerdict: { allowed: true, reason: 'ok' },
    sotAmbiguous: false,
    openHolds: 0,
    prevCyclePrMerged: true,
    phaseGaps: [...GAPS],
    ...overrides,
  }
}

function expectRefusal(decision: PlanDecision, reasonRe: RegExp, recoveryRe: RegExp): void {
  expect(decision.action).toBe('refuse')
  if (decision.action !== 'refuse') return
  expect(decision.reason).toMatch(reasonRe)
  expect(decision.recovery).toMatch(recoveryRe)
}

describe('planNextCycle — refusal matrix (V6-P4 L1)', () => {
  it('refuses on a dirty working tree with a human recovery action', () => {
    const d = planNextCycle(baseInput({ repoDirty: true }))
    expectRefusal(d, /dirty/i, /commit|stash/i)
  })

  it('refuses when tests are not green', () => {
    const d = planNextCycle(baseInput({ testsGreen: false }))
    expectRefusal(d, /test/i, /pnpm test|fix/i)
  })

  it('refuses when the budget verdict blocks, carrying the budget reason', () => {
    const d = planNextCycle(baseInput({ budgetVerdict: { allowed: false, reason: 'day_cap' } }))
    expectRefusal(d, /budget.*day_cap/is, /AEDEV_BUDGET|wait/i)
  })

  it('refuses when the SoT is ambiguous (more than one root workbook claims SoT)', () => {
    const d = planNextCycle(baseInput({ sotAmbiguous: true }))
    expectRefusal(d, /source of truth|SoT/i, /SUPERSEDED|single/i)
  })

  it('refuses when there are open holds', () => {
    const d = planNextCycle(baseInput({ openHolds: 2 }))
    expectRefusal(d, /2 open hold/i, /resolve/i)
  })

  it('refuses when the previous cycle PR is not merged (one in-flight cycle max)', () => {
    const d = planNextCycle(baseInput({ prevCyclePrMerged: false }))
    expectRefusal(d, /previous cycle/i, /merge|close/i)
  })

  it('refuses when §0 is unparseable (treated as SoT ambiguity)', () => {
    const d = planNextCycle(baseInput({ workbookSection0: 'narrative text, no machine state' }))
    expectRefusal(d, /§0|section 0/i, /WORKBOOK_v6/i)
  })

  it('refuses honestly when there is no gap to work on', () => {
    const d = planNextCycle(baseInput({ phaseGaps: [] }))
    expectRefusal(d, /no .*gap/i, /WORKBOOK/i)
  })

  it('refusal precedence: dirty tree is reported first when everything is wrong', () => {
    const d = planNextCycle(baseInput({
      repoDirty: true, testsGreen: false, sotAmbiguous: true, openHolds: 3,
      budgetVerdict: { allowed: false, reason: 'day_cap' }, prevCyclePrMerged: false,
    }))
    expectRefusal(d, /dirty/i, /commit|stash/i)
  })
})

describe('planNextCycle — single-pick priority (V6-P4 L1)', () => {
  it('proposes exactly one cycle and picks the safety_evidence gap over all others', () => {
    const d = planNextCycle(baseInput())
    expect(d.action).toBe('propose')
    if (d.action !== 'propose') return
    expect(d.cycle.gapId).toBe('g-safety')
    expect(d.cycle.phase).toBe('V6-P3')
    expect(d.cycle.rationale).toMatch(/safety_evidence/)
    expect(d.cycle.expectedDeliverable).toContain('real Draft PR + real Gemini verdict evidence in-repo')
    expect(d.cycle.expectedDeliverable).toMatch(/Draft PR/i)
  })

  it('follows the strict priority chain when higher categories are absent', () => {
    // Drop categories one by one from the top; the next category must win.
    const order = ['g-safety', 'g-ux', 'g-auto', 'g-fleet', 'g-polish']
    let gaps = [...GAPS]
    for (const expected of order) {
      const d = planNextCycle(baseInput({ phaseGaps: gaps }))
      expect(d.action).toBe('propose')
      if (d.action === 'propose') expect(d.cycle.gapId).toBe(expected)
      gaps = gaps.filter((g) => g.id !== expected)
    }
  })

  it('breaks ties inside a category by stable input order', () => {
    const d = planNextCycle(baseInput({
      phaseGaps: [
        { id: 'safety-first', phase: 'V6-P3', description: 'first listed', category: 'safety_evidence' },
        { id: 'safety-second', phase: 'V6-P3', description: 'second listed', category: 'safety_evidence' },
      ],
    }))
    expect(d.action).toBe('propose')
    if (d.action === 'propose') expect(d.cycle.gapId).toBe('safety-first')
  })

  it('exports the fixed priority order for shells and docs', () => {
    expect(GAP_PRIORITY).toEqual(['safety_evidence', 'user_ux', 'automation', 'fleet', 'polish'])
  })
})

describe('parseSection0', () => {
  it('extracts current_phase / open_holds / merge_policy, stripping comments', () => {
    const s = parseSection0(SECTION0)
    expect(s).toEqual({ currentPhase: 'V6-P4', openHolds: 0, mergePolicy: 'human_only' })
  })

  it('returns null when current_phase is missing', () => {
    expect(parseSection0('open_holds: 0')).toBeNull()
    expect(parseSection0('')).toBeNull()
  })
})

describe('SoT claim detection', () => {
  const V6_HEAD = '# WORKBOOK v6\n\n> **本文件是当前唯一事实源 (SoT)。** 取代 `WORKBOOK_v4.md`（该文件原地保留并加\n> SUPERSEDED 头）。'
  const V4_HEAD = '# WORKBOOK v4\n\n> ⚠️ **SUPERSEDED（2026-06-11）。本文件不再是事实源。**\n\n> **本文件是新的唯一事实源 (SoT)。**（已失效）'

  it('counts a live SoT claim but not a SUPERSEDED one', () => {
    expect(claimsSourceOfTruth(V6_HEAD)).toBe(true)
    expect(claimsSourceOfTruth(V4_HEAD)).toBe(false)
    expect(claimsSourceOfTruth('# random doc')).toBe(false)
  })

  it('is unambiguous with exactly one claimant, ambiguous with zero or two', () => {
    expect(detectSotAmbiguity([
      { name: 'WORKBOOK_v6.md', text: V6_HEAD },
      { name: 'WORKBOOK_v4.md', text: V4_HEAD },
    ])).toEqual({ ambiguous: false, claimants: ['WORKBOOK_v6.md'] })
    expect(detectSotAmbiguity([
      { name: 'WORKBOOK_v6.md', text: V6_HEAD },
      { name: 'WORKBOOK_v7.md', text: V6_HEAD },
    ]).ambiguous).toBe(true)
    expect(detectSotAmbiguity([{ name: 'WORKBOOK_v4.md', text: V4_HEAD }]).ambiguous).toBe(true)
  })
})

describe('cycle ledger (V6-P4 L1 — reconstructable from events, GR#5)', () => {
  let dir: string
  let db: AedevDb

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'aedev-loop-cycles-'))
    db = new AedevDb(':memory:')
  })

  afterEach(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  it('appends cycle-1.json then cycle-2.json with the contract fields', () => {
    const propose = planNextCycle(baseInput())
    const e1 = appendCycleLedger({ dir, decision: propose, workbookPhase: 'V6-P4' })
    expect(e1.cycle).toBe(1)
    const refuse = planNextCycle(baseInput({ repoDirty: true }))
    const e2 = appendCycleLedger({ dir, decision: refuse, workbookPhase: 'V6-P4' })
    expect(e2.cycle).toBe(2)
    expect(readdirSync(dir).sort()).toEqual(['cycle-1.json', 'cycle-2.json'])
    const onDisk = JSON.parse(readFileSync(join(dir, 'cycle-1.json'), 'utf8')) as Record<string, unknown>
    expect(Object.keys(onDisk).sort()).toEqual(['chosen_gap', 'cycle', 'decision', 'timestamp', 'workbook_phase'])
    expect(onDisk['workbook_phase']).toBe('V6-P4')
    expect(onDisk['chosen_gap']).toBe('g-safety')
    expect(typeof onDisk['timestamp']).toBe('string')
    const second = JSON.parse(readFileSync(join(dir, 'cycle-2.json'), 'utf8')) as Record<string, unknown>
    expect(second['chosen_gap']).toBeNull()
  })

  it('event-sources every entry so the ledger rebuilds from events alone', () => {
    appendCycleLedger({ dir, decision: planNextCycle(baseInput()), workbookPhase: 'V6-P4', db })
    appendCycleLedger({ dir, decision: planNextCycle(baseInput({ openHolds: 1 })), workbookPhase: 'V6-P4', db })
    expect(db.queryEvents({ type: CYCLE_PLANNED_EVENT })).toHaveLength(2)
    const rebuilt = rebuildCycleLedgerFromEvents(db)
    const fromDisk = readdirSync(dir).sort().map((f) => JSON.parse(readFileSync(join(dir, f), 'utf8')) as unknown)
    expect(rebuilt).toEqual(fromDisk)
  })

  it('a refused decision never proposes work in the same call (one decision per cycle)', () => {
    const refused = planNextCycle(baseInput({ openHolds: 1 }))
    expect(refused.action).toBe('refuse')
    const entry = appendCycleLedger({ dir, decision: refused, workbookPhase: 'V6-P4' })
    expect(entry.chosen_gap).toBeNull()
  })
})
