/** WORKBOOK_v4 P2 — cross-engine review (GR#9).
 *
 * After the Codex worker produces evidence and BEFORE the Gemini final judge,
 * Claude reviews the diff + PRD/roadmap + failing logs from the evidence
 * bundle only — never the coder conversation. The verdict is structured JSON:
 * `{verdict: "approve"|"rework", findings[], confidence}`. A `rework` verdict
 * sends the coder into a repair round, capped by
 * `AEDEV_BUDGET_MAX_REVIEW_CYCLES` (default 2) → over the cap the mission
 * holds with HOLD-REVIEW-LOOP instead of fake-passing (GR#7).
 *
 * Review is in-process QA. Gemini stays the only final judge; the two gates
 * never substitute for each other (GR#9).
 *
 * Every review call is a metered headless claude call: it goes through the
 * P1 budget guard (checked before spawn, recorded after).
 */
import type { AedevDb } from '@aedev/core'
import { ClaudeCodeAdapter } from '@aedev/runner'
import {
  HOLD_BUDGET_CODE,
  checkHeadlessBudget,
  createBudgetHold,
  recordHeadlessCall,
} from './headless-budget-guard.js'

export const HOLD_REVIEW_LOOP_CODE = 'HOLD-REVIEW-LOOP'
export const HOLD_REVIEW_STRUCTURE_CODE = 'HOLD-REVIEW-STRUCTURE'
export const DEFAULT_MAX_REVIEW_CYCLES = 2

export interface ReviewVerdict {
  verdict: 'approve' | 'rework'
  findings: string[]
  confidence: number
}

export interface MissionReviewInput {
  missionId: string
  cycle: number
  /** Evidence bundle (filename → content). Evidence-only by construction. */
  bundle: Record<string, string>
}

export interface MissionReviewer {
  review(input: MissionReviewInput): Promise<ReviewVerdict>
}

/** Thrown when the review cannot proceed honestly (budget exhausted, CLI
 *  missing, unparseable output). The mission runner converts it into a held
 *  result with the carried hold code — never a silent approve. */
export class ReviewBlockedError extends Error {
  constructor(readonly holdCode: string, message: string) {
    super(message)
    this.name = 'ReviewBlockedError'
  }
}

export function maxReviewCyclesFromEnv(env: Record<string, string | undefined> = process.env): number {
  const raw = env['AEDEV_BUDGET_MAX_REVIEW_CYCLES']
  if (raw === undefined || raw.trim() === '') return DEFAULT_MAX_REVIEW_CYCLES
  const n = Number(raw)
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : DEFAULT_MAX_REVIEW_CYCLES
}

/** Parse the reviewer's structured JSON verdict. Tolerates surrounding prose
 *  but never invents a verdict: missing/invalid structure → null. */
export function parseReviewVerdict(text: string): ReviewVerdict | null {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  let parsed: unknown
  try {
    parsed = JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
  if (typeof parsed !== 'object' || parsed === null) return null
  const obj = parsed as Record<string, unknown>
  const verdict = obj['verdict']
  if (verdict !== 'approve' && verdict !== 'rework') return null
  const findings = Array.isArray(obj['findings'])
    ? obj['findings'].filter((f): f is string => typeof f === 'string')
    : []
  const confidenceRaw = obj['confidence']
  const confidence = typeof confidenceRaw === 'number' && Number.isFinite(confidenceRaw)
    ? Math.max(0, Math.min(100, confidenceRaw <= 1 ? confidenceRaw * 100 : confidenceRaw))
    : 0
  if (verdict === 'rework' && findings.length === 0) {
    // A rework demand with no findings is not actionable; treat as unstructured.
    return null
  }
  return { verdict, findings, confidence }
}

/** Pick the evidence files a reviewer needs (PRD, diff, gates/logs, risk),
 *  with a per-file cap so the prompt stays bounded. */
export function selectReviewEvidence(bundle: Record<string, string>, maxPerFile = 12_000): Array<{ name: string; content: string }> {
  const interesting = /prd|adr|roadmap|diff|changed-paths|gate|log|test|lint|typecheck|risk|done-report|summary/i
  return Object.entries(bundle)
    .filter(([name]) => interesting.test(name))
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, content]) => ({
      name,
      content: content.length > maxPerFile ? `${content.slice(0, maxPerFile)}\n…[truncated]` : content,
    }))
}

export interface ClaudeReviewerOptions {
  db: AedevDb
  /** Budget attribution key (operator session id or mission id). */
  budgetKey: string
  timeoutMs?: number
  adapter?: Pick<ClaudeCodeAdapter, 'isAvailable' | 'run'>
}

export class ClaudeReviewer implements MissionReviewer {
  private readonly adapter: Pick<ClaudeCodeAdapter, 'isAvailable' | 'run'>

  constructor(private readonly opts: ClaudeReviewerOptions) {
    this.adapter = opts.adapter ?? new ClaudeCodeAdapter()
  }

  async review(input: MissionReviewInput): Promise<ReviewVerdict> {
    const { db, budgetKey } = this.opts
    const budgetVerdict = checkHeadlessBudget(db, budgetKey)
    if (!budgetVerdict.allowed) {
      const reason = createBudgetHold(db, budgetKey, budgetVerdict)
      throw new ReviewBlockedError(HOLD_BUDGET_CODE, reason)
    }
    if (!(await this.adapter.isAvailable())) {
      throw new ReviewBlockedError(HOLD_REVIEW_STRUCTURE_CODE, 'No healthy local Claude CLI for the review round.')
    }
    const files = selectReviewEvidence(input.bundle)
    const prompt = [
      'You are the cross-engine reviewer for an autonomous coding mission (review cycle '
        + `${input.cycle}). You see EVIDENCE ONLY — never the coder conversation.`,
      'Review the diff and logs against the PRD/roadmap acceptance criteria.',
      'Focus on: correctness, missed acceptance criteria, security, unnecessary complexity.',
      'Return ONE JSON object only, no markdown fence:',
      '{"verdict":"approve"|"rework","findings":string[],"confidence":number}',
      'Rules: "rework" MUST include concrete, actionable findings. Do not approve unverified work.',
      '',
      ...files.flatMap(({ name, content }) => [`=== ${name} ===`, content, '']),
    ].join('\n')
    const timeoutMs = this.opts.timeoutMs ?? Number(process.env['AEDEV_COCKPIT_AI_TIMEOUT_MS'] ?? '300000')
    const result = await this.adapter.run(prompt, process.cwd(), { timeoutMs, permissionMode: 'bypassPermissions' })
    recordHeadlessCall(db, budgetKey, {
      role: 'reviewer',
      provider: 'claude-cli',
      authMode: result.authMode,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      exitCode: result.exitCode,
    })
    if (result.exitCode !== 0 || !result.transcript.trim()) {
      throw new ReviewBlockedError(HOLD_REVIEW_STRUCTURE_CODE, `Review CLI failed: ${result.error ?? `exit ${result.exitCode}`}`)
    }
    const verdict = parseReviewVerdict(result.transcript)
    if (!verdict) {
      throw new ReviewBlockedError(HOLD_REVIEW_STRUCTURE_CODE, 'Reviewer did not return structured JSON {verdict,findings,confidence}; refusing to guess (GR#7).')
    }
    return verdict
  }
}
