import type { MissionDesign } from '@aedev/core'

export interface DocFollowupInput {
  missionId: string
  draftPrUrl: string
  design: MissionDesign
  changedFiles: string[]
  validatorPassed: boolean
}

export interface DocFollowupPlan {
  taskTitle: string
  docsToUpdate: string[]
  memoryProposal: string | null
  splitPrRecommended: boolean
}

const SECRET_PATTERN = /PASSWORD\s*=|TOKEN\s*=|SECRET\s*=|API_KEY\s*=/i

export function planDocFollowup(input: DocFollowupInput): DocFollowupPlan {
  const docs = new Set<string>()
  docs.add('CHANGELOG.md')
  if (/operator|daemon|scheduler|approval|hold|launchd/i.test(input.design.title + input.design.prd.summary)) {
    docs.add('docs/OPERATIONS.md')
  }
  if (/ADR|architecture|schema|event|worker pool/i.test(input.design.title + input.design.prd.summary)) {
    docs.add('docs/adr/')
  }
  if (input.changedFiles.some((file) => file.startsWith('README') || file.includes('/README'))) {
    docs.add('README.md')
  }

  const memory = [
    `Mission ${input.missionId} produced draft PR ${input.draftPrUrl}.`,
    `Decision: ${input.design.adrDraft.decision}`,
    `Rollback: ${input.design.prd.rollbackPlan}`,
  ].join('\n')

  return {
    taskTitle: `Document mission ${input.missionId}`,
    docsToUpdate: [...docs].sort(),
    memoryProposal: input.validatorPassed && !SECRET_PATTERN.test(memory) ? memory : null,
    splitPrRecommended: docs.size > 3,
  }
}
