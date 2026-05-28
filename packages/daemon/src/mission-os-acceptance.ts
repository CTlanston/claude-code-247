import { existsSync, mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'

export type MissionOsAcceptanceStatus = 'pass' | 'failed' | 'hold'

export interface AcceptanceCommandResult {
  command: string
  exitCode: number
  durationMs: number
  stdoutPath?: string
  stderrPath?: string
}

export interface AcceptanceRouteDecision {
  role: string
  provider: string | null
  holdCode?: string
  reason: string
}

export interface AcceptanceCheck {
  name: string
  passed: boolean
  detail: string
}

export interface MissionOsAcceptanceInput {
  stageId: string
  startedAt: string
  endedAt: string
  commands: AcceptanceCommandResult[]
  evidencePaths: string[]
  routeDecisions: AcceptanceRouteDecision[]
  stageChecks?: AcceptanceCheck[]
  validatorLeakScan: AcceptanceCheck
  sideEffectIdempotency: AcceptanceCheck
  draftPr: AcceptanceCheck
  realSoak: AcceptanceCheck
  holds?: string[]
}

export interface MissionOsAcceptanceReport extends MissionOsAcceptanceInput {
  schemaVersion: 1
  status: MissionOsAcceptanceStatus
  failures: string[]
  reportPath: string
}

export function buildMissionOsAcceptanceReport(
  input: MissionOsAcceptanceInput,
  reportPath: string,
): MissionOsAcceptanceReport {
  const failures: string[] = []
  const holds = input.holds ?? []

  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(input.stageId)) {
    failures.push(`invalid stage id: ${input.stageId}`)
  }

  for (const command of input.commands) {
    if (command.exitCode !== 0) {
      failures.push(`command failed: ${command.command}`)
    }
  }

  for (const evidencePath of input.evidencePaths) {
    if (!existsSync(evidencePath)) {
      failures.push(`missing evidence path: ${evidencePath}`)
    }
  }

  for (const check of [
    ...(input.stageChecks ?? []),
    input.validatorLeakScan,
    input.sideEffectIdempotency,
    input.draftPr,
    input.realSoak,
  ]) {
    if (!check.passed) {
      failures.push(`${check.name}: ${check.detail}`)
    }
  }

  const status: MissionOsAcceptanceStatus =
    failures.length > 0 ? 'failed' : holds.length > 0 ? 'hold' : 'pass'

  return {
    schemaVersion: 1,
    ...input,
    holds,
    status,
    failures,
    reportPath,
  }
}

export function writeMissionOsAcceptanceReport(
  input: MissionOsAcceptanceInput,
  outputDir: string,
): MissionOsAcceptanceReport {
  mkdirSync(outputDir, { recursive: true })
  const reportPath = join(outputDir, 'acceptance.json')
  const report = buildMissionOsAcceptanceReport(input, reportPath)
  writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n')
  return report
}
