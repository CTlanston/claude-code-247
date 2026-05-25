import type { Role, RoleContext, RoleOutput } from './role-interface.js'

/**
 * QA role — emits a test summary template plus a screenshot-report stub
 * when the mission requires UI work.  Real test execution and Playwright
 * capture happen in Phase 6.
 */
export class QARole implements Role {
  readonly name = 'qa' as const

  async execute(ctx: RoleContext): Promise<RoleOutput> {
    const testSummary = `# Test Summary — ${ctx.mission.title}

**Mission:** ${ctx.mission.id}
**Generated:** ${new Date().toISOString()}
**Status:** Pending — populated by the test runner.

## Unit tests
- [ ] All green

## Integration tests
- [ ] All green

## Coverage
- [ ] Meets repo threshold

## Notes
<!-- QA agent to populate with the actual test runner output -->
`

    const evidenceFiles: Record<string, string> = { 'test-summary.md': testSummary }

    if (ctx.requiresUi) {
      const screenshotReport = `# Screenshot Report — ${ctx.mission.title}

**Mission:** ${ctx.mission.id}
**Generated:** ${new Date().toISOString()}
**Status:** Pending — Playwright capture runs in Phase 6.

## Captured viewports
- [ ] Mobile (360x800)
- [ ] Tablet (768x1024)
- [ ] Desktop (1280x800)

## Visual review
- [ ] AI visual reviewer flagged no regressions
- [ ] No layout overlap detected
- [ ] Tap targets ≥ 44px on mobile

## Files
- (screenshot paths populated by BrowserQA after Phase 6 lands)
`
      evidenceFiles['screenshot-report.md'] = screenshotReport
    }

    return {
      evidenceFiles,
      notes: ctx.requiresUi ? 'QA emitted test + screenshot stubs.' : 'QA emitted test stub.',
    }
  }
}
