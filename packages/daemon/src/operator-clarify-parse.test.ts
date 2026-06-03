import { describe, it, expect } from 'vitest'
import { parseClarifyQuestions } from './routes/operator.js'

// P3 — the planner now emits goal-specific clarifying questions as a fenced ```json
// block; parseClarifyQuestions turns those into the clickable clarification cards
// (replacing the hardcoded QUESTION_BANK template), and strips the block from the
// prose shown in the chat.
describe('parseClarifyQuestions (P3 — planner-generated clarifications)', () => {
  it('parses a fenced json block into structured questions and strips it from content', () => {
    const content = [
      'Here is my analysis of your goal.',
      '',
      '```json',
      JSON.stringify([
        { question: 'Which TTS engine should Marvis use?', options: [{ label: 'Tencent cloud TTS', recommended: true }, { label: 'Local model' }] },
        { question: 'Scope of v1?', options: [{ label: 'Single repo', recommended: true }, { label: 'Multi-repo' }] },
      ]),
      '```',
    ].join('\n')
    const { questions, cleaned } = parseClarifyQuestions(content)
    expect(questions).toHaveLength(2)
    expect(questions[0]!.question).toMatch(/TTS engine/)
    expect(questions[0]!.options.find((o) => o.recommended)?.label).toBe('Tencent cloud TTS')
    expect(questions[0]!.id).toMatch(/^clq-/)
    // The raw JSON must not leak into the chat bubble.
    expect(cleaned).not.toContain('```json')
    expect(cleaned).toContain('analysis of your goal')
  })

  it('parses the P2 clarification object with confidence and rationale', () => {
    const content = [
      'Planner view.',
      '',
      '```json',
      JSON.stringify({
        questions: [
          { field: 'scope', question: 'How broad?', options: [{ label: 'Small', recommended: true }, { label: 'Broad' }] },
        ],
        confidence: 62,
        rationale: 'The target is still broad.',
      }),
      '```',
    ].join('\n')

    const parsed = parseClarifyQuestions(content)

    expect(parsed.questions).toHaveLength(1)
    expect(parsed.confidence).toBe(62)
    expect(parsed.rationale).toBe('The target is still broad.')
    expect(parsed.cleaned).not.toContain('```json')
  })

  it('returns no questions and unchanged content when there is no json block', () => {
    const content = 'Just prose, no structured questions here.'
    const { questions, cleaned } = parseClarifyQuestions(content)
    expect(questions).toHaveLength(0)
    expect(cleaned).toBe(content)
  })

  it('ignores malformed json and questions with fewer than two options', () => {
    expect(parseClarifyQuestions('```json\n{ not valid json\n```').questions).toHaveLength(0)
    const thin = '```json\n[{"question":"Q?","options":[{"label":"only one"}]}]\n```'
    expect(parseClarifyQuestions(thin).questions).toHaveLength(0)
  })
})
