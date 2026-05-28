/**
 * Shared evidence-bundle → LLM-prompt formatter.  Used by GeminiValidator and
 * OpenAIValidator.  Per ADR-0008/0009, validators see only evidence files —
 * never the Coder's conversation context, hidden chain-of-thought, or raw
 * source dumps.  This module is the only place the evidence-prompt shape is
 * defined.
 */
export interface EvidencePromptInput {
  taskId: string
  bundle: Record<string, string>
  /** Optional risk score (0-100) to surface in the prompt. */
  riskScore?: number
}

const MAX_FILE_CHARS = 8000

const EXPECTED_FILES = [
  'plan.md',
  'diff-summary.md',
  'test-summary.md',
  'done-report.md',
  'screenshot-report.md',
  'preview-url.txt',
  'risk-report.md',
] as const

export function buildEvidencePrompt(input: EvidencePromptInput): string {
  const redacted = redactForValidator(input.bundle)
  const bundle = redacted.bundle
  const lines: string[] = []
  lines.push(`You are a strict, evidence-only validator for the aedev autonomous engineering system.`)
  lines.push(``)
  lines.push(`Decide whether the engineering task is safe to merge based ONLY on the evidence below.`)
  lines.push(`You do not see the Coder's conversation or raw source.  Be skeptical: missing evidence is a red flag.`)
  lines.push(``)
  lines.push(`Reply with a single JSON object on stdout.  Schema:`)
  lines.push(`  { "verdict": "pass" | "fail" | "inconclusive", "summary": "<one-paragraph rationale>", "reasons": ["<bullet>", ...] }`)
  lines.push(``)
  lines.push(`Decision rules:`)
  lines.push(`- "pass" only if all required evidence is present, tests pass, no secrets/forbidden paths, risk is low, and the diff matches the plan.`)
  lines.push(`- "fail" if there is a clear safety, correctness, or scope violation.`)
  lines.push(`- "inconclusive" if evidence is incomplete or contradictory and you cannot decide.`)
  lines.push(``)
  lines.push(`---`)
  lines.push(`Task ID: ${input.taskId}`)
  if (redacted.removed.length > 0) {
    lines.push(`Redacted evidence files: ${redacted.removed.join(', ')}`)
  }
  if (input.riskScore !== undefined) {
    lines.push(`Risk score (0-100): ${input.riskScore}`)
  }
  lines.push(``)

  for (const name of EXPECTED_FILES) {
    const content = bundle[name]
    if (content === undefined) {
      lines.push(`### ${name}`)
      lines.push(`(missing)`)
      lines.push(``)
    } else {
      lines.push(`### ${name}`)
      lines.push('```')
      lines.push(truncate(content, MAX_FILE_CHARS))
      lines.push('```')
      lines.push(``)
    }
  }

  // Any extra files outside the expected list — surface but truncate harder.
  const extras = Object.keys(bundle).filter((k) => !EXPECTED_FILES.includes(k as typeof EXPECTED_FILES[number]))
  for (const name of extras) {
    lines.push(`### ${name} (extra)`)
    lines.push('```')
    lines.push(truncate(bundle[name] ?? '', MAX_FILE_CHARS / 2))
    lines.push('```')
    lines.push(``)
  }

  lines.push(`---`)
  lines.push(`Emit only the JSON object.  Do not include prose outside the JSON.`)
  return lines.join('\n')
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s
  return s.slice(0, max) + `\n…[truncated ${s.length - max} chars]`
}

/** Parse a free-form model response into { verdict, summary, reasons }, tolerant of stray text. */
export function parseVerdictPayload(raw: string): { verdict: 'pass' | 'fail' | 'inconclusive'; summary: string; reasons: string[] } {
  const trimmed = raw.trim()
  // Try direct JSON
  const direct = safeParse(trimmed)
  if (direct) return normalize(direct)
  // Try to find a JSON object embedded in prose
  const match = trimmed.match(/\{[\s\S]*\}/)
  if (match) {
    const recovered = safeParse(match[0])
    if (recovered) return normalize(recovered)
  }
  // Couldn't parse — return inconclusive
  return {
    verdict: 'inconclusive',
    summary: `Validator response was not valid JSON.  Raw response: ${trimmed.slice(0, 400)}`,
    reasons: [],
  }
}

function safeParse(s: string): Record<string, unknown> | null {
  try {
    const x = JSON.parse(s) as unknown
    if (x && typeof x === 'object' && !Array.isArray(x)) return x as Record<string, unknown>
    return null
  } catch {
    return null
  }
}

function normalize(obj: Record<string, unknown>): { verdict: 'pass' | 'fail' | 'inconclusive'; summary: string; reasons: string[] } {
  const v = String(obj['verdict'] ?? '').toLowerCase()
  const verdict: 'pass' | 'fail' | 'inconclusive' =
    v === 'pass' ? 'pass' :
    v === 'fail' ? 'fail' :
    'inconclusive'
  const summary = typeof obj['summary'] === 'string' ? (obj['summary']) : ''
  const reasonsRaw = obj['reasons']
  const reasons: string[] = Array.isArray(reasonsRaw)
    ? reasonsRaw.filter((r): r is string => typeof r === 'string')
    : []
  return { verdict, summary, reasons }
}
import { redactForValidator } from './redact.js'
