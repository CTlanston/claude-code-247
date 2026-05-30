import { mkdirSync, writeFileSync } from 'fs'
import { join } from 'path'
import type { AedevDb, Mission, MissionDesign } from '@aedev/core'
import { generateId, nowIso } from '@aedev/core'

/**
 * Structured Clarification Gate (ADR-0020).
 *
 * Sits between intake and the role pipeline.  When a mission is ambiguous
 * (no verifiable acceptance criteria, vague wording, no target surface,
 * unbounded scope) the gate proactively asks a small number of structured
 * questions BEFORE the coder runs, then folds the answers into a verifiable
 * `clarified-spec.md`.  Clear missions pass straight through (not over-gated).
 *
 * The scorer is deterministic (no LLM) so the gate is fast, testable, and every
 * trigger is explainable via `reasons`.
 */

export interface ClarificationPolicy {
  enabled: boolean
  triggerThreshold: number
  maxQuestions: number
  minAcceptanceCriteria: number
  signals: {
    noAcceptanceCriteria: number
    vagueDescription: number
    noTargetSurface: number
    unboundedScope: number
  }
}

export const DEFAULT_CLARIFICATION_POLICY: ClarificationPolicy = {
  enabled: true,
  triggerThreshold: 50,
  maxQuestions: 4,
  minAcceptanceCriteria: 1,
  signals: {
    noAcceptanceCriteria: 60,
    vagueDescription: 25,
    noTargetSurface: 20,
    unboundedScope: 25,
  },
}

/** A field the gate can clarify. */
export type ClarificationField = 'acceptance-criteria' | 'scope' | 'target' | 'done-definition'

export interface ClarificationChoice {
  label: string
  /** Optional concrete value folded into the spec when chosen. */
  value?: string
}

export interface ClarificationQuestion {
  id: string
  field: ClarificationField
  question: string
  choices: ClarificationChoice[]
  recommendedDefault: string
}

export interface AmbiguityResult {
  score: number
  reasons: string[]
  /** Fields that are missing/unclear — drives which questions get asked. */
  missing: ClarificationField[]
}

export interface ClarificationAnswer {
  questionId: string
  field: ClarificationField
  answer: string
}

const VAGUE_PATTERNS = [
  /\bimprove\b/i, /\bbetter\b/i, /\bpolish\b/i, /\bnicer?\b/i, /\bclean ?up\b/i,
  /\bsome\b/i, /\bvarious\b/i, /\betc\b/i, /and so on/i, /\bstuff\b/i,
  /\benhance\b/i, /\boptimi[sz]e\b/i, /\bmake it (nice|good|work)/i,
]
const UNBOUNDED_PATTERNS = [
  /\beverything\b/i, /\ball the\b/i, /\bwhole (code ?base|repo|project|app)\b/i,
  /\bentire\b/i, /\brewrite\b/i, /\bfrom scratch\b/i,
]
// A "target surface" = a concrete file/path/component/command/symbol.
const TARGET_PATTERNS = [
  /[\w./-]+\.(ts|js|tsx|jsx|py|md|json|yaml|yml|css|html|sh)\b/i, // a filename
  /\b(README|package\.json|Dockerfile|tests?\/|src\/|docs\/|scripts?\/)/i,
  /`[^`]+`/,                       // a code span (command/symbol)
  /\b[A-Z][a-zA-Z]+(Service|Runner|Gate|Adapter|Validator|Manager|Policy)\b/, // a class
]
// Placeholder / non-verifiable acceptance criteria.
const PLACEHOLDER_AC = [
  /^tbd\b/i, /^todo\b/i, /verify it works/i, /^it works/i, /^done$/i, /^n\/?a$/i,
]

/** True when an acceptance-criterion line is concrete/verifiable enough to count. */
function isVerifiableCriterion(c: string): boolean {
  const t = c.trim()
  if (t.length < 12) return false
  if (PLACEHOLDER_AC.some((re) => re.test(t))) return false
  return true
}

/**
 * Deterministic ambiguity score (0..100, clamped) over cheap signals.
 * The mission is ambiguous (gate triggers) when score >= policy.triggerThreshold.
 */
export function scoreAmbiguity(
  mission: Pick<Mission, 'description' | 'title'>,
  design: MissionDesign | null,
  policy: ClarificationPolicy = DEFAULT_CLARIFICATION_POLICY,
): AmbiguityResult {
  const desc = `${mission.title ?? ''}\n${mission.description ?? ''}`.trim()
  const reasons: string[] = []
  const missing: ClarificationField[] = []
  let score = 0

  const verifiable = (design?.prd.acceptanceCriteria ?? []).filter(isVerifiableCriterion)
  if (verifiable.length < policy.minAcceptanceCriteria) {
    score += policy.signals.noAcceptanceCriteria
    reasons.push(`fewer than ${policy.minAcceptanceCriteria} verifiable acceptance criteria (found ${verifiable.length})`)
    missing.push('acceptance-criteria')
  }

  if (VAGUE_PATTERNS.some((re) => re.test(desc))) {
    score += policy.signals.vagueDescription
    reasons.push('description uses vague intent wording (e.g. improve/better/polish)')
    if (!missing.includes('done-definition')) missing.push('done-definition')
  }

  if (!TARGET_PATTERNS.some((re) => re.test(desc))) {
    score += policy.signals.noTargetSurface
    reasons.push('no concrete target surface named (file/path/component/command)')
    missing.push('target')
  }

  if (UNBOUNDED_PATTERNS.some((re) => re.test(desc))) {
    score += policy.signals.unboundedScope
    reasons.push('scope appears unbounded (everything/whole/rewrite)')
    missing.push('scope')
  }

  return { score: Math.min(100, score), reasons, missing }
}

export interface ClarificationEvaluation {
  required: boolean
  ambiguity: AmbiguityResult
  questions: ClarificationQuestion[]
}

const QUESTION_BANK: Record<ClarificationField, Omit<ClarificationQuestion, 'id'>> = {
  'acceptance-criteria': {
    field: 'acceptance-criteria',
    question: 'What is the single most important, observable acceptance criterion for this mission?',
    choices: [
      { label: 'A specific test/command must pass' },
      { label: 'A named file/section must exist with specific content' },
      { label: 'An observable behavior in the app/UI must change' },
    ],
    recommendedDefault: 'A specific test/command must pass',
  },
  target: {
    field: 'target',
    question: 'Which concrete file, component, or command should this change touch?',
    choices: [
      { label: 'A specific source file/module' },
      { label: 'Docs (README/PROGRESS/docs/**)' },
      { label: 'Tests (tests/**)' },
    ],
    recommendedDefault: 'Docs (README/PROGRESS/docs/**)',
  },
  scope: {
    field: 'scope',
    question: 'How should scope be bounded for this single mission?',
    choices: [
      { label: 'Smallest viable change to one file' },
      { label: 'One feature across a few files' },
      { label: 'Split into multiple missions' },
    ],
    recommendedDefault: 'Smallest viable change to one file',
  },
  'done-definition': {
    field: 'done-definition',
    question: 'What concretely makes this mission "done" (beyond "it works")?',
    choices: [
      { label: 'Tests pass + reviewer approves' },
      { label: 'A specific artifact is produced and verified' },
      { label: 'A measurable metric improves by a stated amount' },
    ],
    recommendedDefault: 'Tests pass + reviewer approves',
  },
}

export class ClarificationGate {
  constructor(
    private readonly db: AedevDb,
    private readonly stateDir: string,
    private readonly policy: ClarificationPolicy = DEFAULT_CLARIFICATION_POLICY,
  ) {}

  /** Decide whether a mission needs clarification and, if so, build the questions. */
  evaluate(mission: Pick<Mission, 'description' | 'title'>, design: MissionDesign | null): ClarificationEvaluation {
    const ambiguity = scoreAmbiguity(mission, design, this.policy)
    if (!this.policy.enabled || ambiguity.score < this.policy.triggerThreshold) {
      return { required: false, ambiguity, questions: [] }
    }
    const questions = this.generateQuestions(ambiguity)
    return { required: true, ambiguity, questions }
  }

  /** Build ≤ maxQuestions option-style questions from the missing fields. */
  generateQuestions(ambiguity: AmbiguityResult): ClarificationQuestion[] {
    const fields = ambiguity.missing.length > 0
      ? ambiguity.missing
      : (['acceptance-criteria'] as ClarificationField[])
    const seen = new Set<ClarificationField>()
    const questions: ClarificationQuestion[] = []
    // ID must be unique per question. generateId() is a ULID whose first ~10
    // chars are the millisecond timestamp, so slicing it collides for questions
    // built in the same ms — key the id by field (one question per field) plus a
    // short id suffix for global uniqueness across missions.
    const suffix = generateId().slice(-6)
    for (const f of fields) {
      if (seen.has(f)) continue
      seen.add(f)
      questions.push({ id: `clq-${f}-${suffix}`, ...QUESTION_BANK[f] })
      if (questions.length >= this.policy.maxQuestions) break
    }
    return questions
  }

  /**
   * Request clarification: persist questions and emit
   * `mission.clarification.requested`.  Returns the questions asked.
   */
  request(missionId: string, evaluation: ClarificationEvaluation): ClarificationQuestion[] {
    const dir = this.clarificationDir(missionId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'questions.json'), JSON.stringify({
      missionId, ambiguity: evaluation.ambiguity, questions: evaluation.questions, requestedAt: nowIso(),
    }, null, 2))
    this.db.insertEvent('mission.clarification.requested', 'mission', missionId, {
      score: evaluation.ambiguity.score,
      reasons: evaluation.ambiguity.reasons,
      questionCount: evaluation.questions.length,
      questionIds: evaluation.questions.map((q) => q.id),
    })
    return evaluation.questions
  }

  /**
   * Record operator answers and emit `mission.clarification.answered`, then
   * fold them into a verifiable `clarified-spec.md` and emit
   * `mission.clarification.resolved`.  Returns the spec path.
   */
  resolve(missionId: string, questions: ClarificationQuestion[], answers: ClarificationAnswer[]): string {
    const dir = this.clarificationDir(missionId)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'answers.json'), JSON.stringify({ missionId, answers, answeredAt: nowIso() }, null, 2))
    this.db.insertEvent('mission.clarification.answered', 'mission', missionId, {
      answerCount: answers.length,
      fields: answers.map((a) => a.field),
    })

    const specPath = join(this.stateDir, 'prd', `${missionId}.clarified-spec.md`)
    mkdirSync(join(this.stateDir, 'prd'), { recursive: true })
    writeFileSync(specPath, renderClarifiedSpec(missionId, questions, answers))
    this.db.insertEvent('mission.clarification.resolved', 'mission', missionId, {
      specPath,
      acceptanceCount: answers.filter((a) => a.field === 'acceptance-criteria' || a.field === 'done-definition').length,
    })
    return specPath
  }

  /** Derive clarification status from the event log (event-sourced; no DB column). */
  status(missionId: string): 'not_required' | 'requested' | 'answered' | 'resolved' {
    const events = this.db.queryEvents({ entityId: missionId })
    const has = (t: string): boolean => events.some((e) => e.type === t)
    if (has('mission.clarification.resolved')) return 'resolved'
    if (has('mission.clarification.answered')) return 'answered'
    if (has('mission.clarification.requested')) return 'requested'
    return 'not_required'
  }

  private clarificationDir(missionId: string): string {
    return join(this.stateDir, 'clarification', missionId)
  }
}

/** Render a verifiable clarified-spec.md from the Q&A. */
export function renderClarifiedSpec(
  missionId: string,
  questions: ClarificationQuestion[],
  answers: ClarificationAnswer[],
): string {
  const byId = new Map(questions.map((q) => [q.id, q]))
  const lines: string[] = [
    `# Clarified Spec — ${missionId}`,
    '',
    'Operator answers to the clarification gate, folded into verifiable acceptance points.',
    '',
    '## Verifiable acceptance criteria',
  ]
  const ac = answers.filter((a) => a.field === 'acceptance-criteria' || a.field === 'done-definition')
  if (ac.length === 0) {
    lines.push('- (none provided)')
  } else {
    for (const a of ac) lines.push(`- ${a.answer}`)
  }
  lines.push('', '## Scope & target')
  const st = answers.filter((a) => a.field === 'scope' || a.field === 'target')
  if (st.length === 0) {
    lines.push('- (not constrained)')
  } else {
    for (const a of st) lines.push(`- ${a.field}: ${a.answer}`)
  }
  lines.push('', '## Q&A')
  for (const a of answers) {
    const q = byId.get(a.questionId)
    lines.push(`- **${q?.question ?? a.questionId}** → ${a.answer}`)
  }
  lines.push('')
  return lines.join('\n')
}
