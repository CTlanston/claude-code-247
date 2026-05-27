import { describe, it, expect } from 'vitest'
import { buildStatusBoard, serializeStatusBoard, type StatusBoardInput } from './status-board.js'

const SAMPLE: StatusBoardInput = {
  missionsOpen: 3,
  missionsTotal: 12,
  tasksRunning: 2,
  tasksQueued: 5,
  holdsOpen: 1,
  approvalsPending: 0,
  sessionHealth: 'healthy',
  quotaFraction: 0.42,
}

describe('dashboard · status-board JSON (Stage F2 L1)', () => {
  it('case 1: schema_version is locked to 1', () => {
    const b = buildStatusBoard(SAMPLE, '2026-05-27T00:00:00Z')
    expect(b.schema_version).toBe(1)
  })

  it('case 2: same input + same generated_at → byte-equal JSON', () => {
    const ts = '2026-05-27T00:00:00Z'
    const a = serializeStatusBoard(buildStatusBoard(SAMPLE, ts))
    const b = serializeStatusBoard(buildStatusBoard(SAMPLE, ts))
    expect(a).toBe(b)
  })

  it('case 3: different generated_at is the ONLY divergence allowed by contract', () => {
    const a = serializeStatusBoard(buildStatusBoard(SAMPLE, '2026-05-27T00:00:00Z'))
    const b = serializeStatusBoard(buildStatusBoard(SAMPLE, '2026-05-27T00:00:01Z'))
    expect(a).not.toBe(b)
    // strip generated_at and compare
    const stripA = a.replace(/"generated_at":"[^"]+"/, '"generated_at":"X"')
    const stripB = b.replace(/"generated_at":"[^"]+"/, '"generated_at":"X"')
    expect(stripA).toBe(stripB)
  })

  it('case 4: contract shape — only documented top-level keys are present', () => {
    const b = buildStatusBoard(SAMPLE, '2026-05-27T00:00:00Z')
    expect(Object.keys(b).sort()).toEqual(
      ['approvals', 'cli', 'generated_at', 'holds', 'missions', 'schema_version', 'tasks'].sort(),
    )
  })

  it('case 5: nested shape — cli has session_health + quota_fraction only', () => {
    const b = buildStatusBoard(SAMPLE, '2026-05-27T00:00:00Z')
    expect(Object.keys(b.cli).sort()).toEqual(['quota_fraction', 'session_health'])
  })
})
