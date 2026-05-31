import { useState } from 'react'
import type { ApiOperatorQuestion } from '../../api.js'

function defaultValue(q: ApiOperatorQuestion): string {
  const rec = q.options.find((o) => o.recommended) ?? q.options[0]
  return rec ? (rec.value ?? rec.label) : ''
}

/** Interactive clarification cards (PRD §B): options + free-form, answer-all CTA. */
export function ClarificationCard({ questions, answered, busy, onSubmit }: {
  questions: ApiOperatorQuestion[]
  answered: boolean
  busy: string | null
  onSubmit: (answers: { questionId: string; value: string }[]) => void
}) {
  const [picks, setPicks] = useState<Record<string, string>>(() =>
    Object.fromEntries(questions.map((q) => [q.id, defaultValue(q)])))
  const [free, setFree] = useState<Record<string, string>>({})

  if (answered) {
    return <div className="ck-clar done">✓ Answered · 已确认（见下方对话）</div>
  }

  const answers = questions.map((q) => ({ questionId: q.id, value: (free[q.id]?.trim() || picks[q.id] || '').trim() }))
  const ready = answers.every((a) => a.value)

  return (
    <div className="ck-clar">
      <div className="ck-clar-head">Clarify before I plan · 先确认这些问题</div>
      {questions.map((q) => (
        <div key={q.id} className="ck-clar-q">
          <div className="ck-clar-question">{q.question}</div>
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
            placeholder="…or type your own · 或自定义回答"
            value={free[q.id] ?? ''}
            onChange={(e) => setFree((f) => ({ ...f, [q.id]: e.target.value }))}
          />
        </div>
      ))}
      <button className="ck-btn primary" disabled={!ready || Boolean(busy)} onClick={() => onSubmit(answers)}>
        Answer all &amp; continue · 全部确认并继续
      </button>
    </div>
  )
}
