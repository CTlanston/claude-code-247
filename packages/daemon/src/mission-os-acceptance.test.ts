import { mkdtempSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { describe, expect, it } from 'vitest'
import {
  buildMissionOsAcceptanceReport,
  writeMissionOsAcceptanceReport,
  type MissionOsAcceptanceInput,
} from './mission-os-acceptance.js'

describe('Mission OS acceptance report', () => {
  it('passes only when commands, evidence, and required checks pass', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mission-os-acceptance-'))
    const evidencePath = join(dir, 'route.json')
    writeFileSync(evidencePath, '{}\n')

    const report = buildMissionOsAcceptanceReport(validInput(evidencePath), join(dir, 'acceptance.json'))

    expect(report.schemaVersion).toBe(1)
    expect(report.status).toBe('pass')
    expect(report.failures).toEqual([])
    expect(report.routeDecisions[0]?.provider).toBe('codex-cli')
  })

  it('fails when required evidence is missing', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mission-os-acceptance-'))

    const report = buildMissionOsAcceptanceReport(validInput(join(dir, 'missing.json')), join(dir, 'acceptance.json'))

    expect(report.status).toBe('failed')
    expect(report.failures[0]).toContain('missing evidence path')
  })

  it('writes acceptance.json to the stage evidence directory', () => {
    const dir = mkdtempSync(join(tmpdir(), 'mission-os-acceptance-'))
    const evidenceDir = join(dir, 'evidence')
    mkdirSync(evidenceDir)
    const evidencePath = join(evidenceDir, 'route.json')
    writeFileSync(evidencePath, '{}\n')

    const report = writeMissionOsAcceptanceReport(validInput(evidencePath), join(dir, 'stage-audit'))

    expect(report.reportPath.endsWith('acceptance.json')).toBe(true)
    expect(report.status).toBe('pass')
  })
})

function validInput(evidencePath: string): MissionOsAcceptanceInput {
  return {
    stageId: 'audit',
    startedAt: '2026-05-28T00:00:00.000Z',
    endedAt: '2026-05-28T00:01:00.000Z',
    commands: [{ command: 'pnpm test:mission-os:dry-soak -- --iterations 1', exitCode: 0, durationMs: 10 }],
    evidencePaths: [evidencePath],
    routeDecisions: [{ role: 'coder', provider: 'codex-cli', reason: 'selected codex-cli for coder' }],
    validatorLeakScan: { name: 'validator leak scan', passed: true, detail: '0 forbidden tokens' },
    sideEffectIdempotency: { name: 'side effect idempotency', passed: true, detail: 'same key reused' },
    draftPr: { name: 'draft PR gate', passed: true, detail: 'dry-run draft=true' },
    realSoak: { name: 'real soak policy', passed: true, detail: 'not required for audit harness unit test' },
  }
}
