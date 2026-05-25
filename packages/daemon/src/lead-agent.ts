export class LeadAgent {
  constructor(private stateDir: string) {
    // stateDir reserved for future use (ADR/roadmap writing)
    void this.stateDir
  }

  generatePrdTemplate(missionId: string, description: string): string {
    return `# PRD: ${description}

**Mission ID:** ${missionId}
**Status:** Draft — awaiting human review and approval
**Created:** ${new Date().toISOString()}

---

## Summary
<!-- Describe what this mission delivers in 1-2 sentences -->
${description}

## Problem Statement
<!-- What problem are we solving? -->

## Goals
<!-- What must be true when this mission is done? -->
- [ ]

## Non-Goals
<!-- What is explicitly out of scope? -->
-

## Success Criteria
<!-- Measurable / observable outcomes -->
- [ ]

## Acceptance Criteria
<!-- Verifiable checks that a Validator can evaluate from evidence only -->
- [ ]

## Risks and Mitigation
<!-- What could go wrong? -->

## Notes
<!-- Additional context for the Builder agent -->
`
  }
}
