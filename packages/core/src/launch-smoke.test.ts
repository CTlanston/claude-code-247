/** Tests for the SmokeHarness library. The CLI shim lives at
 *  scripts/launch-smoke.ts; this exercises the harness itself. */
import { describe, it, expect } from 'vitest'
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  SmokeHarness, renderMarkdown, syntheticChecks,
  type SmokeCheck, type SmokeReport,
} from './launch-smoke.js'

async function tmpDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), 'launch-smoke-'))
}

describe('launch-smoke · orchestrator (Phase L0 L1)', () => {
  it('case 1: 7/7 synthetic checks → LAUNCH_AUTHORIZED', async () => {
    const dir = await tmpDir()
    const harness = new SmokeHarness({
      mode: 'synthetic',
      checks: syntheticChecks(),
      evidenceDir: dir,
    })
    const report = await harness.run()
    expect(report.verdict).toBe('LAUNCH_AUTHORIZED')
    expect(report.pass_count).toBe(7)
    expect(report.checks.every((c) => c.status === 'pass')).toBe(true)
  }, 30_000)

  it('case 2: a single failing check → FIX_AND_RETRY (binary per GR11)', async () => {
    const checks: SmokeCheck[] = syntheticChecks()
    checks[3] = {
      ...checks[3],
      run: async () => { throw new Error('mission did not reach PR') },
    }
    const dir = await tmpDir()
    const harness = new SmokeHarness({ mode: 'synthetic', checks, evidenceDir: dir })
    const report = await harness.run()
    expect(report.verdict).toBe('FIX_AND_RETRY')
    expect(report.pass_count).toBe(6)
    expect(report.checks[3].status).toBe('fail')
    expect(report.checks[3].error).toMatch(/mission did not reach PR/)
  }, 30_000)

  it('case 3: window exceeded → window_exceeded (not pass)', async () => {
    const checks: SmokeCheck[] = syntheticChecks()
    checks[0] = {
      id: 1, name: 'slow boot', windowSeconds: 0.1,  // 100ms window
      run: async () => {
        await new Promise((r) => setTimeout(r, 300))
        return {}
      },
    }
    const dir = await tmpDir()
    const harness = new SmokeHarness({ mode: 'synthetic', checks, evidenceDir: dir })
    const report = await harness.run()
    expect(report.checks[0].status).toBe('window_exceeded')
    expect(report.verdict).toBe('FIX_AND_RETRY')
  }, 30_000)

  it('case 4: artifacts — smoke-<ts>.json and smoke-<ts>.md both written', async () => {
    const dir = await tmpDir()
    const harness = new SmokeHarness({
      mode: 'synthetic', checks: syntheticChecks(), evidenceDir: dir,
    })
    await harness.run()
    const files = await fs.readdir(dir)
    expect(files.some((f) => f.startsWith('smoke-') && f.endsWith('.json'))).toBe(true)
    expect(files.some((f) => f.startsWith('smoke-') && f.endsWith('.md'))).toBe(true)
  }, 30_000)

  it('case 5: total elapsed < total_budget on synthetic run', async () => {
    const dir = await tmpDir()
    const harness = new SmokeHarness({
      mode: 'synthetic', checks: syntheticChecks(), evidenceDir: dir,
    })
    const report = await harness.run()
    expect(report.total_seconds).toBeLessThan(report.total_budget_seconds)
  }, 30_000)

  it('case 6: markdown renderer table has one row per check', () => {
    const fake: SmokeReport = {
      started_at: '2026-05-27T00:00:00Z',
      ended_at: '2026-05-27T00:00:01Z',
      mode: 'synthetic',
      pass_count: 7,
      total: 7,
      total_seconds: 1.2,
      total_budget_seconds: 1800,
      verdict: 'LAUNCH_AUTHORIZED',
      checks: syntheticChecks().map((c, i) => ({
        id: c.id, name: c.name,
        status: 'pass' as const,
        windowSeconds: c.windowSeconds,
        observedSeconds: 0.1 * (i + 1),
      })),
    }
    const md = renderMarkdown(fake)
    expect(md).toMatch(/LAUNCH_AUTHORIZED/)
    // 7 rows after the table header + separator
    const rowCount = md.split('\n').filter((l) => l.startsWith('| ') && !l.startsWith('| #') && !l.startsWith('|---')).length
    expect(rowCount).toBe(7)
  })
})
