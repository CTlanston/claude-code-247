import { useEffect, useRef } from 'react'
import Markdown from 'react-markdown'
import type { ApiOperatorChoice, ApiOperatorMessage } from '../../api.js'

export function ChatThread({ messages, busy, canChoose, onChoice }: {
  messages: ApiOperatorMessage[]
  busy: string | null
  canChoose: boolean
  onChoice: (choice: ApiOperatorChoice) => void
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  // Choices belong to the most recent assistant turn that carries them (mirrors the
  // pre-redesign ChoiceBar) and only before a mission exists.
  const lastChoiceId = canChoose
    ? [...messages].reverse().find((m) => m.choices && m.choices.length)?.id
    : undefined

  return (
    <div className="ck-thread">
      {messages.length === 0 && (
        <div className="ck-turn assistant"><div className="ck-bubble">Describe your goal below to start a brainstorm · 在下方描述你的目标开始讨论。</div></div>
      )}
      {messages.map((m) => (
        <div key={m.id} className={`ck-turn ${m.role}`}>
          <span className="ck-role">{m.role}</span>
          <div className="ck-bubble">
            {m.role === 'assistant' || m.role === 'system'
              ? <div className="ck-md"><Markdown>{m.content}</Markdown></div>
              : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
          </div>
          {m.id === lastChoiceId && m.choices && (
            <div className="ck-composer-actions">
              {m.choices.map((c) => (
                <button key={c.id} className="ck-btn" disabled={Boolean(busy)} onClick={() => onChoice(c)} title={c.labelEn}>
                  {c.label}
                </button>
              ))}
            </div>
          )}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  )
}
