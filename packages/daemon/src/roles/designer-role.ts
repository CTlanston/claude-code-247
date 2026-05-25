import type { Role, RoleContext, RoleOutput } from './role-interface.js'

/**
 * Designer role — only runs when the mission requires UI work.  Emits a
 * design brief with page map, component inventory, responsive behaviour,
 * and visual acceptance criteria.  Template-based MVP.
 */
export class DesignerRole implements Role {
  readonly name = 'designer' as const

  async execute(ctx: RoleContext): Promise<RoleOutput> {
    if (!ctx.requiresUi) {
      return {
        evidenceFiles: {
          'design-brief.md': `# Design Brief\n\n_Mission ${ctx.mission.id} has no UI scope.  Designer skipped._\n`,
        },
        notes: 'Designer skipped — mission has no UI scope.',
      }
    }

    const brief = `# Design Brief — ${ctx.mission.title}

**Mission:** ${ctx.mission.id}
**Generated:** ${new Date().toISOString()}

## Visual Direction
<!-- Designer agent to populate.  Reference design system tokens if the repo has one. -->

## Page Map
- \`/\` — landing
- (additional pages — designer agent to populate)

## Component Inventory
- [ ] Header
- [ ] Footer
- [ ] (component list)

## Responsive Behaviour
- Mobile: 360 / 414 width
- Tablet: 768 width
- Desktop: 1280 / 1920 width

## Visual Acceptance Criteria
- [ ] No layout overlaps in any viewport
- [ ] Contrast ratio ≥ 4.5:1 for text
- [ ] Tap targets ≥ 44px on mobile
- [ ] Screenshot evidence captured at all three breakpoints
- [ ] AI visual reviewer flags no obvious regressions
`

    return {
      evidenceFiles: { 'design-brief.md': brief },
      notes: 'Designer emitted UI brief.',
    }
  }
}
