import type { Role, RoleContext, RoleOutput } from './role-interface.js'

/**
 * Reviewer role — collates the evidence bundle, lists each expected
 * artefact's status, and produces a review checklist for the dual
 * validators (and any human reviewer) to use.
 */
export class ReviewerRole implements Role {
  readonly name = 'reviewer' as const

  async execute(ctx: RoleContext): Promise<RoleOutput> {
    const expected = [
      'prd.md',
      'architecture.md',
      'roadmap.md',
      'risk-map.md',
      'design-brief.md',
      'tasks.json',
      'task-list.md',
      'test-summary.md',
      'screenshot-report.md',
      'diff-summary.md',
      'done-report.md',
      'preview-url.txt',
    ]
    const lines: string[] = [
      `# Reviewer Checklist — ${ctx.mission.title}`,
      '',
      `**Mission:** ${ctx.mission.id}`,
      `**Generated:** ${new Date().toISOString()}`,
      '',
      '## Evidence audit',
    ]
    for (const f of expected) {
      const status = ctx.bundle[f] !== undefined ? '✅ present' : '⚠️ missing'
      const optional = (f === 'design-brief.md' || f === 'screenshot-report.md') && !ctx.requiresUi
      lines.push(`- ${f}: ${status}${optional ? ' (optional — no UI scope)' : ''}`)
    }
    lines.push('')
    lines.push('## Manual review notes')
    lines.push('- [ ] Diff matches plan')
    lines.push('- [ ] Tests cover the acceptance criteria')
    lines.push('- [ ] No secret-scan hits')
    lines.push('- [ ] No forbidden-path touches')

    return {
      evidenceFiles: { 'reviewer-checklist.md': lines.join('\n') + '\n' },
      notes: 'Reviewer audited the evidence bundle.',
    }
  }
}
