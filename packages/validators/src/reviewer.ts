export interface ReviewResult {
  passed: boolean
  issues: string[]
  summary: string
}

export class EvidenceReviewer {
  review(bundle: Record<string, string>): ReviewResult {
    const issues: string[] = []
    if (!bundle['plan.md']) issues.push('Missing plan.md — task must include a plan')
    if (!bundle['test-summary.md']) issues.push('Missing test-summary.md — test results required')
    if (!bundle['done-report.md']) issues.push('Missing done-report.md — completion report required')
    if (!bundle['diff-summary.md']) issues.push('Missing diff-summary.md — diff summary recommended')
    const passed = issues.filter((i) => !i.includes('recommended')).length === 0
    const summary = passed
      ? `Evidence review passed. ${Object.keys(bundle).length} files reviewed.`
      : `Evidence review failed. Issues: ${issues.join('; ')}`
    return { passed, issues, summary }
  }
}
