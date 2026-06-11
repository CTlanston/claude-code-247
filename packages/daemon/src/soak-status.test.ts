/**
 * V6-P5 — `soak-pending.json` status artifact contract
 * (docs/operations/SOAK_OPERATIONS.md; shell is scripts/soak-status.ts).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  WEEK_MS,
  buildSoakPending,
  deriveSoakStatus,
  readSoakPending,
  writeSoakPending,
  type SoakPending,
} from './soak-status.js'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'aedev-soak-status-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

describe('soak-pending artifact (V6-P5)', () => {
  it('buildSoakPending: started_at + expected_end = start + soakMs, status running', () => {
    const start = new Date('2026-06-11T00:00:00.000Z')
    const p = buildSoakPending(start, WEEK_MS)
    expect(p).toEqual({
      started_at: '2026-06-11T00:00:00.000Z',
      expected_end: '2026-06-18T00:00:00.000Z',
      status: 'running',
    })
    expect(WEEK_MS).toBe(604_800_000)
  })

  it('deriveSoakStatus: running inside the window, overdue once expected_end passes', () => {
    const p = buildSoakPending(new Date('2026-06-11T00:00:00Z'), WEEK_MS)
    expect(deriveSoakStatus(p, new Date('2026-06-14T00:00:00Z'))).toBe('running')
    expect(deriveSoakStatus(p, new Date('2026-06-18T00:00:00.001Z'))).toBe('overdue')
  })

  it('deriveSoakStatus: terminal states are sticky (completed/failed never flip)', () => {
    const base = buildSoakPending(new Date('2026-06-11T00:00:00Z'), WEEK_MS)
    const done: SoakPending = { ...base, status: 'completed' }
    const failed: SoakPending = { ...base, status: 'failed' }
    expect(deriveSoakStatus(done, new Date('2099-01-01T00:00:00Z'))).toBe('completed')
    expect(deriveSoakStatus(failed, new Date('2026-06-12T00:00:00Z'))).toBe('failed')
  })

  it('write/read roundtrip preserves the exact contract fields', () => {
    const path = join(dir, 'soak-pending.json')
    const p = buildSoakPending(new Date('2026-06-11T01:02:03Z'), 1000)
    writeSoakPending(path, p)
    expect(readSoakPending(path)).toEqual(p)
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    expect(Object.keys(raw).sort()).toEqual(['expected_end', 'started_at', 'status'])
  })

  it('readSoakPending: missing file or invalid content reads as null (fail-closed)', () => {
    expect(readSoakPending(join(dir, 'missing.json'))).toBeNull()
    const bad = join(dir, 'bad.json')
    writeFileSync(bad, 'not json')
    expect(readSoakPending(bad)).toBeNull()
    const wrongShape = join(dir, 'wrong.json')
    writeFileSync(wrongShape, JSON.stringify({ started_at: 1, status: 'running' }))
    expect(readSoakPending(wrongShape)).toBeNull()
  })
})
