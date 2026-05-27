/**
 * NEXT_PLAN_WORKBOOK §3 Phase L0 — 30-Minute Smoke CLI shim.
 *
 * The orchestrator lives in @aedev/core; this file is the CLI surface.
 * Operator on launch day:
 *
 *   pnpm tsx scripts/launch-smoke.ts --synthetic        # CI / dry-run
 *   pnpm tsx scripts/launch-smoke.ts                    # real (operator)
 *
 * 7/7 within the 30-min budget → LAUNCH_AUTHORIZED.
 * Artifacts written under evidence/launch/smoke-<UTC>.{json,md}.
 */
import { SmokeHarness, renderMarkdown, syntheticChecks } from '../packages/core/src/launch-smoke.js'

async function main(): Promise<void> {
  const synthetic = process.argv.includes('--synthetic')
  const harness = new SmokeHarness({
    mode: synthetic ? 'synthetic' : 'real',
    checks: syntheticChecks(),
  })
  const report = await harness.run()
  console.log(renderMarkdown(report))
  if (report.verdict !== 'LAUNCH_AUTHORIZED') {
    process.exit(1)
  }
}

main().catch((err) => {
  console.error('[smoke] crashed:', err)
  process.exit(2)
})
