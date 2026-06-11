/** WORKBOOK_v6 overnight P5 — evidence audit package.
 *
 * `run-summary.md` is the single audit artifact written into every mission
 * evidence dir at the end of `runMission` (done / failed / held paths).  It
 * complements `workbook-summary.md` (operator-facing narrative) with a
 * machine-auditable, honesty-first digest: every required section is always
 * present, a missing input renders as an explicit "absent" marker (never a
 * fabricated PASS), and the run is explicitly classified
 * real / simulated / unproven (GR: evidence honesty).
 *
 * `renderRunSummary` is pure; `writeRunSummary` is the thin fs writer.
 */
import { existsSync, readdirSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'

export interface RunSummaryValidatorVerdict {
  validator: string
  verdict: string
  summary?: string
}

export interface RunSummaryReviewerVerdict {
  verdict: string
  cycle: number
  findings?: string[]
}

export interface RunSummaryHold {
  code: string
  reason: string
}

export interface RunSummaryInput {
  missionId: string
  missionTitle?: string
  status: string
  /** One-line outcome of the run. */
  summary?: string
  /** Real `git diff` file list from the runner; undefined = file absent. */
  changedPaths?: string[]
  /** Raw diff-summary.md content (stats only are rendered, never re-asserted). */
  diffSummary?: string
  validatorResults?: RunSummaryValidatorVerdict[]
  reviewerVerdict?: RunSummaryReviewerVerdict
  mergeDecision?: string
  /** Real draft-PR URL when one was opened. */
  prUrl?: string
  /** Why no PR exists (gate refusal / decision) when prUrl is absent. */
  prGateOutcome?: string
  /** `model.usage.recorded` event count for this mission. */
  costEvents?: number
  /** `cost.headless_call` event count attributed to this mission. */
  headlessCalls?: number
  holds?: RunSummaryHold[]
  artifacts?: string[]
  /** Coder provider that produced the change (classification input). */
  provider?: string
  /** Local commit sha from local-commit.json (classification input). */
  localCommitSha?: string
}

/** Every render contains all of these (the trailing entry is the
 *  real-vs-simulated classification line, not a markdown heading). */
export const RUN_SUMMARY_SECTIONS = [
  '## Summary',
  '## Changed Paths',
  '## Diff Stats',
  '## Validator Verdicts',
  '## Reviewer Verdict',
  '## PR / Gate Outcome',
  '## Cost & Headless Calls',
  '## Holds',
  '## Artifacts',
  'Classification:',
] as const

export type RunClassification = 'real' | 'simulated' | 'unproven'

/** GR evidence honesty: a run is `real` only when a non-mock provider left
 *  both a local commit and a non-empty changed-paths list; a non-mock
 *  provider without that proof is `unproven`, never `real`. */
export function classifyRun(
  input: Pick<RunSummaryInput, 'provider' | 'localCommitSha' | 'changedPaths'>,
): { label: RunClassification; detail: string } {
  if (!input.provider || input.provider === 'mock') {
    return { label: 'simulated', detail: `coder provider is ${input.provider ?? 'unknown'} — no real worktree run` }
  }
  const changedCount = input.changedPaths?.length ?? 0
  if (input.localCommitSha && changedCount > 0) {
    return {
      label: 'real',
      detail: `provider ${input.provider}, local commit ${input.localCommitSha}, ${changedCount} changed file(s)`,
    }
  }
  const missing = [
    ...(input.localCommitSha ? [] : ['local commit evidence']),
    ...(changedCount > 0 ? [] : ['changed-path evidence']),
  ]
  return {
    label: 'unproven',
    detail: `provider ${input.provider} ran, but ${missing.join(' and ')} is missing — not claiming a real change`,
  }
}

export function renderRunSummary(input: RunSummaryInput): string {
  const lines: string[] = [
    `# Run Summary — ${input.missionId}`,
    '',
    ...(input.missionTitle !== undefined ? [`**Mission:** ${input.missionTitle}`] : []),
    `**Status:** ${input.status}`,
    `**Decision:** ${input.mergeDecision ?? '(absent — no merge decision recorded)'}`,
    '',
    '## Summary',
    input.summary ?? '(absent — no run summary recorded)',
    '',
    '## Changed Paths',
  ]

  if (input.changedPaths === undefined) lines.push('(absent — runner produced no changed-paths.json)')
  else if (input.changedPaths.length === 0) lines.push('(none — empty diff reported by the runner)')
  else for (const p of input.changedPaths) lines.push(`- ${p}`)

  lines.push('', '## Diff Stats')
  if (input.changedPaths === undefined && input.diffSummary === undefined) {
    lines.push('(absent — no diff evidence)')
  } else {
    if (input.changedPaths !== undefined) lines.push(`- files changed: ${input.changedPaths.length}`)
    lines.push(
      input.diffSummary !== undefined
        ? `- diff-summary.md: present (${input.diffSummary.split('\n').length} lines)`
        : '- diff-summary.md: absent',
    )
  }

  lines.push('', '## Validator Verdicts')
  if (!input.validatorResults || input.validatorResults.length === 0) {
    lines.push('(absent — no validator verdict recorded)')
  } else {
    for (const v of input.validatorResults) {
      lines.push(`- ${v.validator}: ${v.verdict}${v.summary ? ` — ${v.summary}` : ''}`)
    }
  }

  lines.push('', '## Reviewer Verdict')
  if (!input.reviewerVerdict) {
    lines.push('(absent — no reviewer verdict recorded)')
  } else {
    lines.push(`- ${input.reviewerVerdict.verdict} (cycle ${input.reviewerVerdict.cycle})`)
    for (const finding of input.reviewerVerdict.findings ?? []) lines.push(`  - ${finding}`)
  }

  lines.push('', '## PR / Gate Outcome')
  if (input.prUrl) lines.push(`- draft PR: ${input.prUrl}`)
  else if (input.prGateOutcome) lines.push(`- gate outcome: ${input.prGateOutcome}`)
  else lines.push('(absent — no PR attempted and no gate outcome recorded)')

  lines.push(
    '',
    '## Cost & Headless Calls',
    `- model usage events: ${input.costEvents ?? 'absent'}`,
    `- headless calls (mission scope): ${input.headlessCalls ?? 'absent'}`,
  )

  lines.push('', '## Holds')
  if (input.holds === undefined) lines.push('(absent — hold state not collected)')
  else if (input.holds.length === 0) lines.push('(none)')
  else for (const h of input.holds) lines.push(`- ${h.code}: ${h.reason}`)

  lines.push('', '## Artifacts')
  if (input.artifacts === undefined) lines.push('(absent — artifacts not listed)')
  else if (input.artifacts.length === 0) lines.push('(none)')
  else for (const a of input.artifacts) lines.push(`- ${a}`)

  const classification = classifyRun(input)
  lines.push('', `Classification: ${classification.label} — ${classification.detail}`, '')
  return lines.join('\n')
}

/** Write run-summary.md into the evidence dir; returns the file path. */
export function writeRunSummary(evidenceDir: string, input: RunSummaryInput): string {
  const path = join(evidenceDir, 'run-summary.md')
  writeFileSync(path, renderRunSummary(input))
  return path
}

/** Sorted top-level evidence files (subdirectories like nodes/ are skipped). */
export function listEvidenceArtifacts(evidenceDir: string): string[] {
  if (!existsSync(evidenceDir)) return []
  return readdirSync(evidenceDir)
    .filter((entry) => {
      try {
        return statSync(join(evidenceDir, entry)).isFile()
      } catch {
        return false
      }
    })
    .sort()
}
