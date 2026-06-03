import { useEffect, useState } from 'react'
import type { ApiOperatorQuestion } from '../../api.js'

function defaultValue(q: ApiOperatorQuestion): string {
  const rec = q.options.find((o) => o.recommended) ?? q.options[0]
  return rec ? (rec.value ?? rec.label) : ''
}

/**
 * Bottom-anchored, blocking clarification popup (redesign v2, P3 / #6). Appears
 * the moment the planner asks goal-specific questions and stays until the operator
 * answers or explicitly Skips — it does not scroll away like an inline card.
 * In real mode, questions must come from the planner (see parseClarifyQuestions).
 * Template questions are allowed only in explicit test/template mode.
 */
export function ClarificationPopup({ questions, busy, onSubmit, onSkip }: {
  questions: ApiOperatorQuestion[]
  busy: string | null
  onSubmit: (answers: { questionId: string; value: string }[]) => void
  onSkip: () => void
}) {
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, defaultValue(q)])))
  const [free, setFree] = useState<Record<string, string>>({})

  const answers = questions.map((q) => ({ questionId: q.id, value: (free[q.id]?.trim() || picks[q.id] || '').trim() }))
  const ready = answers.every((a) => a.value)

  // ⌘/Ctrl+Enter submits when every question has an answer — the popup is the
  // gate, so keep its keyboard affordance close to the operator's hands.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && ready && !busy) {
        e.preventDefault()
        onSubmit(answers)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="ck-clar-popup" role="dialog" aria-modal="true" aria-label="Clarify before I plan">
      <div className="ck-clar-popup-head">
        <span>Clarify before I plan · 先确认这些问题</span>
        <span className="ck-clar-popup-hint">⌘↵ continue</span>
      </div>
      {questions.map((q, qi) => (
        <div key={q.id} className="ck-clar-q">
          <div className="ck-clar-question">{qi + 1}. {q.question}</div>
          <div className="ck-clar-meta">
            {q.why ? <span>Why: {q.why}</span> : null}
            {q.impact ? <span>Impact: {q.impact}</span> : null}
            {q.destination ? <span>Goes into: {q.destination}</span> : null}
          </div>
          <div className="ck-clar-options">
            {q.options.map((o) => {
              const val = o.value ?? o.label
              const selected = !free[q.id] && picks[q.id] === val
              return (
                <button
                  key={o.label}
                  className={`ck-chip${selected ? ' selected' : ''}${o.recommended ? ' recommended' : ''}`}
                  onClick={() => { setPicks((p) => ({ ...p, [q.id]: val })); setFree((f) => ({ ...f, [q.id]: '' })) }}
                >
                  {o.label}{o.recommended ? ' ★' : ''}
                </button>
              )
            })}
          </div>
          <input
            className="ck-clar-free"
            placeholder="…or reply directly · 或直接回复"
            value={free[q.id] ?? ''}
            onChange={(e) => setFree((f) => ({ ...f, [q.id]: e.target.value }))}
          />
        </div>
      ))}
      <div className="ck-clar-popup-actions">
        <button className="ck-btn primary" disabled={!ready || Boolean(busy)} onClick={() => onSubmit(answers)}>
          Answer all &amp; continue · 全部确认并继续
        </button>
        <button className="ck-btn" disabled={Boolean(busy)} onClick={onSkip} title="Use only when the current mission is already concrete enough.">
          Defer · 稍后再答
        </button>
      </div>
    </div>
  )
}
