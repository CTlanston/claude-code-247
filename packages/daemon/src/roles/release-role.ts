import type { Role, RoleContext, RoleOutput } from './role-interface.js'

/**
 * Release role — emits a release checklist + a rollback plan.  Auto-merge
 * and auto-deploy logic live in `release-pipeline.ts` (Phase 8); this role
 * just produces the human-readable artefact the dual validators check.
 */
export class ReleaseRole implements Role {
  readonly name = 'release' as const

  async execute(ctx: RoleContext): Promise<RoleOutput> {
    const checklist = `# Release Checklist — ${ctx.mission.title}

**Mission:** ${ctx.mission.id}
**Generated:** ${new Date().toISOString()}

## Pre-merge
- [ ] Tests pass
- [ ] Typecheck + lint pass
- [ ] Risk score < 30 (low) for auto-merge
- [ ] Dual validators (Gemini + OpenAI) both return \`pass\`
- [ ] No secret-scan hit
- [ ] No forbidden-path touch
- [ ] Preview smoke PASS (if external preview required)
- [ ] Screenshot evidence captured (if UI work)

## Production deploy
- [ ] Repo policy allows production deploy
- [ ] Healthcheck URL configured
- [ ] Direct-revert enabled
- [ ] Sensitive-lane gates satisfied (if mission touches auth/payment/security/deploy)

## Rollback plan
1. \`git revert <merge-sha>\` on main
2. Run release-pipeline rollback hook (Phase 8)
3. Re-verify healthcheck
4. File an incident report at \`incidents/<missionId>.md\`
`

    return {
      evidenceFiles: { 'release-checklist.md': checklist },
      notes: 'Release emitted checklist + rollback plan.',
    }
  }
}
