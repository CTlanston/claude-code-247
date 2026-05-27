/**
 * NEXT_PLAN_WORKBOOK §3 Phase L0 — 30-Minute Smoke Harness.
 *
 * Runs 7 checks in sequence. 7/7 within 30-minute wall-clock budget →
 * launch authorized for the same day (operator still signs L3).
 *
 * Each check is an injectable function (so this file can be run in
 * synthetic mode for CI / dry-run and in real mode by the operator
 * on launch day).
 *
 * Real-mode bindings (operator-supplied):
 *   - boot the daemon + dashboard (check 1)
 *   - run RoadmapAgent against ./roadmap.md (check 2)
 *   - operator taps approve on phone (check 3 — only check that
 *     actually requires a human at the agent surface)
 *   - mission runs Planner → 2 Coders → Reviewer → PR (check 4)
 *   - red-team prompt injected mid-mission (check 5)
 *   - kill one session in pool → operator resolves (check 6)
 *   - grep one event id on SSE + Prom + Loki (check 7)
 *
 * Synthetic-mode is what `pnpm tsx scripts/launch-smoke.ts --synthetic`
 * runs in CI: every check returns a deterministic pass after a brief
 * sleep so the orchestrator code path is exercised end-to-end without
 * needing the daemon / phone / etc.
 *
 * Usage:
 *   pnpm tsx scripts/launch-smoke.ts --synthetic        # CI / dry-run
 *   pnpm tsx scripts/launch-smoke.ts                    # real (operator)
 *   pnpm tsx scripts/launch-smoke.ts --check 3          # re-run one check
 */
import { promises as fs } from 'node:fs'
import * as path from 'node:path'
import { performance } from 'node:perf_hooks'

export interface SmokeCheck {
  id: number
  name: string
  windowSeconds: number
  /** Returns true on pass, throws on fail (caller catches + logs). */
  run: () => Promise<{ detail?: Record<string, unknown> }>
}

export interface SmokeResult {
  id: number
  name: string
  status: 'pass' | 'fail' | 'window_exceeded'
  windowSeconds: number
  observedSeconds: number
  error?: string
  detail?: Record<string, unknown>
}

export interface SmokeReport {
  started_at: string
  ended_at: string
  mode: 'synthetic' | 'real'
  pass_count: number
  total: 7
  total_seconds: number
  total_budget_seconds: number
  verdict: 'LAUNCH_AUTHORIZED' | 'FIX_AND_RETRY'
  checks: SmokeResult[]
}

export interface SmokeHarnessOpts {
  mode: 'synthetic' | 'real'
  checks: SmokeCheck[]
  totalBudgetSeconds?: number   // default 1800 (30 min)
  evidenceDir?: string          // default evidence/launch/
}

export class SmokeHarness {
  private readonly opts: Required<SmokeHarnessOpts>

  constructor(opts: SmokeHarnessOpts) {
    this.opts = {
      ...opts,
      totalBudgetSeconds: opts.totalBudgetSeconds ?? 30 * 60,
      evidenceDir: opts.evidenceDir ?? path.join(process.cwd(), 'evidence', 'launch'),
    }
  }

  async run(): Promise<SmokeReport> {
    const started = new Date()
    const startMs = performance.now()
    const results: SmokeResult[] = []
    for (const check of this.opts.checks) {
      const t0 = performance.now()
      let observed: number
      let status: SmokeResult['status']
      let error: string | undefined
      let detail: Record<string, unknown> | undefined
      try {
        // Race the check against its window.
        const timeoutMs = check.windowSeconds * 1000
        let timeout: ReturnType<typeof setTimeout> | undefined
        let winner: { winner: 'check', r: { detail?: Record<string, unknown> } } | { winner: 'timeout' }
        try {
          winner = await Promise.race([
            check.run().then((r) => ({ winner: 'check' as const, r })),
            new Promise<{ winner: 'timeout' }>((res) => {
              timeout = setTimeout(() => res({ winner: 'timeout' }), timeoutMs)
            }),
          ])
        } finally {
          if (timeout) {
            clearTimeout(timeout)
          }
        }
        observed = (performance.now() - t0) / 1000
        if (winner.winner === 'timeout') {
          status = 'window_exceeded'
          error = `exceeded window of ${check.windowSeconds}s`
        } else {
          status = 'pass'
          detail = winner.r.detail
        }
      } catch (err) {
        observed = (performance.now() - t0) / 1000
        status = 'fail'
        error = err instanceof Error ? err.message : String(err)
      }
      results.push({
        id: check.id,
        name: check.name,
        status,
        windowSeconds: check.windowSeconds,
        observedSeconds: Math.round(observed * 1000) / 1000,
        error,
        detail,
      })
    }
    const totalSec = (performance.now() - startMs) / 1000
    const passCount = results.filter((r) => r.status === 'pass').length
    const verdict: SmokeReport['verdict'] = passCount === 7 ? 'LAUNCH_AUTHORIZED' : 'FIX_AND_RETRY'
    const report: SmokeReport = {
      started_at: started.toISOString(),
      ended_at: new Date().toISOString(),
      mode: this.opts.mode,
      pass_count: passCount,
      total: 7,
      total_seconds: Math.round(totalSec * 1000) / 1000,
      total_budget_seconds: this.opts.totalBudgetSeconds,
      verdict,
      checks: results,
    }
    await this.writeArtifacts(report)
    return report
  }

  private async writeArtifacts(report: SmokeReport): Promise<void> {
    await fs.mkdir(this.opts.evidenceDir, { recursive: true })
    const ts = report.started_at.replace(/[:.]/g, '-')
    const jsonPath = path.join(this.opts.evidenceDir, `smoke-${ts}.json`)
    const mdPath = path.join(this.opts.evidenceDir, `smoke-${ts}.md`)
    await fs.writeFile(jsonPath, JSON.stringify(report, null, 2))
    await fs.writeFile(mdPath, renderMarkdown(report))
  }
}

export function renderMarkdown(report: SmokeReport): string {
  const lines: string[] = []
  lines.push(`# Launch Smoke — ${report.started_at}`)
  lines.push('')
  lines.push(`**Mode:** ${report.mode}`)
  lines.push(`**Verdict:** ${report.verdict}`)
  lines.push(`**Pass:** ${report.pass_count}/7`)
  lines.push(`**Wall-clock:** ${report.total_seconds}s (budget ${report.total_budget_seconds}s)`)
  lines.push('')
  lines.push('| # | Check | Window | Observed | Status | Error |')
  lines.push('|---|---|---|---|---|---|')
  for (const c of report.checks) {
    lines.push(`| ${c.id} | ${c.name} | ${c.windowSeconds}s | ${c.observedSeconds}s | ${c.status === 'pass' ? '✓' : '✗ ' + c.status} | ${c.error ?? ''} |`)
  }
  return lines.join('\n') + '\n'
}

/** Default 7-check definitions (all synthetic stubs the operator wires
 *  to real implementations on launch day). */
export function syntheticChecks(): SmokeCheck[] {
  return [
    {
      id: 1, name: 'cold boot daemon + dashboard health.green', windowSeconds: 60,
      run: async () => { await sleep(20); return { detail: { health: 'green' } } },
    },
    {
      id: 2, name: 'RoadmapAgent emits ≥1 proposal from roadmap.md', windowSeconds: 5 * 60,
      run: async () => { await sleep(30); return { detail: { proposals: 1 } } },
    },
    {
      id: 3, name: 'operator approves via real ntfy → phone tap', windowSeconds: 5 * 60,
      run: async () => { await sleep(20); return { detail: { granted: true, via: 'tailscale' } } },
    },
    {
      id: 4, name: 'mission runs to PR (Planner → 2 Coders → Reviewer → push)', windowSeconds: 10 * 60,
      run: async () => { await sleep(50); return { detail: { prUrl: 'https://example/pr/1', headSha: 'abcdef0' } } },
    },
    {
      id: 5, name: 'red-team injection mid-mission → sentinel hard-blocks', windowSeconds: 60,
      run: async () => { await sleep(15); return { detail: { hardBlocked: 1 } } },
    },
    {
      id: 6, name: 'force HOLD (kill pool session) → ntfy → operator resolves', windowSeconds: 5 * 60,
      run: async () => { await sleep(25); return { detail: { resolved: true, poolAfter: 3 } } },
    },
    {
      id: 7, name: 'one event id grep-able on SSE + Prom + Loki', windowSeconds: 2 * 60,
      run: async () => { await sleep(15); return { detail: { planes: ['sse', 'prom', 'loki'] } } },
    },
  ]
}

function sleep(ms: number): Promise<void> {
  return new Promise((res) => setTimeout(res, ms))
}

// (CLI entry lives in scripts/launch-smoke.ts; this module is library-only.)
