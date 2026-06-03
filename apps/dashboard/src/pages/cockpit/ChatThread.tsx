import { useEffect, useRef, type ReactNode } from 'react'
import Markdown from 'react-markdown'
import type { ApiOperatorChoice, ApiOperatorMessage, ApiOperatorMessageMeta } from '../../api.js'
import { ClarificationCard } from './ClarificationCard.js'

function MessageFooter({ meta }: { meta: ApiOperatorMessageMeta }) {
  const bits: string[] = [meta.provider ?? 'unknown']
  if (meta.authMode) bits.push(meta.authMode === 'api' ? 'paid API' : meta.authMode)
  bits.push(meta.agentMode === 'multi' ? 'multi-agent' : 'single planner')
  // During the thinking phase token usage isn't known yet — show "pending", never blank.
  bits.push(
    typeof meta.inputTokens === 'number' || typeof meta.outputTokens === 'number'
      ? `${meta.inputTokens ?? 0} in / ${meta.outputTokens ?? 0} out`
      : 'tokens pending',
  )
  if (typeof meta.costUsd === 'number') bits.push(`$${meta.costUsd}`)
  return (
    <div className="ck-msg-footer" data-testid="cockpit-message-footer">
      <span>Status: complete · 已完成</span>
      <span>Changed: conversation updated · 对话已更新</span>
      <span>Next: use the visible action dock · 使用当前主按钮</span>
      <span>Provider: {bits.join(' · ')}</span>
      <span>Safety: no remote write from chat turns · 对话消息不会写远程</span>
    </div>
  )
}

export function ChatThread({ messages, busy, canChoose, onChoice, onAnswer, footer }: {
  messages: ApiOperatorMessage[]
  busy: string | null
  canChoose: boolean
  onChoice: (choice: ApiOperatorChoice) => void
  onAnswer: (answers: { questionId: string; value: string }[]) => void
  footer?: ReactNode
}) {
  const endRef = useRef<HTMLDivElement>(null)
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'end' }) }, [messages.length])

  const lastChoiceId = canChoose
    ? [...messages].reverse().find((m) => m.choices && m.choices.length)?.id
    : undefined

  return (
    <div className="ck-thread">
      {messages.length === 0 && (
        <div className="ck-turn assistant"><div className="ck-bubble">Describe your goal below to start a brainstorm · 在下方描述你的目标开始讨论。</div></div>
      )}
      {messages.map((m, i) => {
        const answered = (m.questions?.length ?? 0) > 0
          && messages.slice(i + 1).some((later) => later.role === 'user' && /已确认|Clarifications/.test(later.content))
        return (
          <div key={m.id} className={`ck-turn ${m.role}`}>
            <span className="ck-role">{m.role}</span>
            <div className="ck-bubble">
              {m.role === 'assistant' || m.role === 'system'
                ? <div className="ck-md"><Markdown>{m.content}</Markdown></div>
                : <div style={{ whiteSpace: 'pre-wrap' }}>{m.content}</div>}
              {m.meta && <MessageFooter meta={m.meta} />}
            </div>
            {m.questions && m.questions.length > 0 && answered && (
              // Unanswered clarifications live in the bottom blocking ClarificationPopup
              // (redesign v2, P3/#6); inline we only keep the read-only answered summary.
              <ClarificationCard questions={m.questions} answered={answered} busy={busy} onSubmit={onAnswer} />
            )}
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
        )
      })}
      {footer}
      <div ref={endRef} />
    </div>
  )
}
