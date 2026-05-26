import type { Role, RoleContext, RoleOutput } from './role-interface.js'

/**
 * Architect role — reads the PRD and emits architecture, roadmap, risk map,
 * and a single bootstrap ADR stub.  Template-based MVP per Phase 5 scope.
 */
export class ArchitectRole implements Role {
  readonly name = 'architect' as const

  async execute(ctx: RoleContext): Promise<RoleOutput> {
    const prd = ctx.bundle['prd.md'] ?? ctx.bundle[`${ctx.mission.id}.md`] ?? ''
    const prdSummary = prd ? firstSection(prd, '## Summary') : '(no PRD on record)'
    const repoId = ctx.mission.repoId
    const missionId = ctx.mission.id

    const architecture = `# Architecture Plan — ${ctx.mission.title}

**Mission:** ${missionId}
**Repo:** ${repoId}
**Generated:** ${new Date().toISOString()}

## PRD Summary
${prdSummary}

## Component Map
<!-- Architect agent to fill in -->
- [ ] Frontend
- [ ] API
- [ ] Persistence
- [ ] Background jobs (if any)

## Data Flow
<!-- Architect agent to fill in -->

## Stack Choices
<!-- Detected from the repo by default; override here if the mission requires a different stack -->

## Migration / Bootstrap Notes
<!-- Anything operators must do before this mission can land -->
`

    const roadmap = `# Roadmap — ${ctx.mission.title}

**Mission:** ${missionId}
**Generated:** ${new Date().toISOString()}

## Milestones
1. Scaffolding
2. Core feature
3. UI polish (if applicable)
4. QA pass (tests + screenshots)
5. External preview + smoke
6. Reviewer + dual-validator
7. Auto-merge if low-risk

## Task graph
See \`tasks.json\` after Builder runs.
`

    const riskMap = `# Risk Map — ${ctx.mission.title}

**Mission:** ${missionId}
**Default risk level:** ${ctx.riskLevel ?? 'medium'}

## Known risks
- [ ] None recorded yet — Architect to populate
`

    const adrStub = `# ADR-${missionId.slice(0, 8)}: ${ctx.mission.title}

**Status:** Draft
**Date:** ${new Date().toISOString().slice(0, 10)}

## Context
<!-- Why is this mission necessary? -->

## Decision
<!-- What architectural choice is being made? -->

## Alternatives
- (none listed yet)

## Consequences
<!-- Trade-offs accepted -->
`

    return {
      evidenceFiles: {
        'architecture.md': architecture,
        'roadmap.md': roadmap,
        'risk-map.md': riskMap,
        'adr-mission.md': adrStub,
      },
      notes: `Architect emitted 4 artefacts for mission ${missionId}.`,
    }
  }
}

function firstSection(md: string, heading: string): string {
  const idx = md.indexOf(heading)
  if (idx === -1) return md.slice(0, 400)
  const rest = md.slice(idx + heading.length)
  const next = rest.search(/\n## /)
  return (next === -1 ? rest : rest.slice(0, next)).trim() || '(empty)'
}
