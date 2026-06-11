/**
 * v6-P2 — the five-card loop cockpit surface (WORKBOOK_v6 GR#11).
 *
 * Renders exactly ONE of the five ordinary-user cards derived by the daemon
 * (`overview.operatorView.card`, packages/daemon/src/loop-cards.ts). Three
 * rules from docs/product/LOOP_COMMUNICATION_PROTOCOL.md:
 *  1. Machine codes stay in the data layer — the `machine` sub-object is
 *     exposed ONLY through data-* attributes, never as visible text.
 *  2. Visible text is calm and bilingual.
 *  3. Every card answers "what happens next" via a prominent `next_step`.
 */
import type { ReactNode } from 'react'
import type { ApiLoopCard } from '../../api.js'

const TYPE_LABELS: Record<ApiLoopCard['type'], string> = {
  understanding: '理解 · Understanding',
  plan: '方案 · Plan',
  progress: '进展 · Progress',
  blocker: '需要你 · Needs you',
  pr_ready: '收尾 · Ready for you',
}

const RISK_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: '低 · low',
  medium: '中 · medium',
  high: '高 · high',
}

function Row({ k, children }: { k: string; children: ReactNode }) {
  return (
    <div className="ck-loop-row">
      <dt>{k}</dt>
      <dd>{children}</dd>
    </div>
  )
}

function List({ items }: { items: string[] }) {
  return (
    <ul className="ck-loop-list">
      {items.map((item, i) => <li key={i}>{item}</li>)}
    </ul>
  )
}

function UnderstandingBody({ card }: { card: Extract<ApiLoopCard, { type: 'understanding' }> }) {
  return (
    <dl className="ck-loop-body">
      <Row k="目标 · Goal">{card.user_goal}</Row>
      <Row k="理解 · Reading">{card.interpreted_goal}</Row>
      <Row k="把握 · Confidence">{card.confidence > 0 ? `${card.confidence}%` : '评估中 · being assessed'}</Row>
      {card.out_of_scope.length > 0 && <Row k="不做 · Out of scope"><List items={card.out_of_scope} /></Row>}
      {card.questions.length > 0 && (
        <Row k="待确认 · Questions"><List items={card.questions.map((q) => q.question)} /></Row>
      )}
      {card.default_assumptions.length > 0 && (
        <Row k="默认 · Defaults"><List items={card.default_assumptions} /></Row>
      )}
    </dl>
  )
}

function PlanBody({ card }: { card: Extract<ApiLoopCard, { type: 'plan' }> }) {
  return (
    <dl className="ck-loop-body">
      <Row k="目标 · Objective">{card.objective}</Row>
      <Row k="步骤 · Phases">
        {card.phases.length > 0
          ? <List items={card.phases} />
          : '步骤会随方案展开 · Phases appear as the plan takes shape.'}
      </Row>
      <Row k="验收 · Acceptance"><List items={card.acceptance_criteria} /></Row>
      <Row k="风险 · Risk">{RISK_LABELS[card.risk_level]}</Row>
      <Row k="预算 · Budget">{`最多 ${card.estimated_calls} 次调用 · up to ${card.estimated_calls} calls`}</Row>
      {card.requires_approval && (
        <Row k="批准 · Approval">需要你批准后才会动手；merge 永远由你执行 · Nothing runs until you approve; merging stays yours.</Row>
      )}
    </dl>
  )
}

function ProgressBody({ card }: { card: Extract<ApiLoopCard, { type: 'progress' }> }) {
  return (
    <dl className="ck-loop-body">
      <Row k="阶段 · Phase">{card.current_phase}</Row>
      <Row k="正在做 · Doing">{card.current_action}</Row>
      <Row k="检查 · Checks">
        {card.tests_run.length > 0 ? <List items={card.tests_run} /> : '还没有检查记录 · No checks recorded yet.'}
      </Row>
      <Row k="证据 · Evidence">
        {card.evidence_links.length > 0
          ? <List items={card.evidence_links} />
          : '证据生成后会列在这里 · Evidence appears here once produced.'}
      </Row>
    </dl>
  )
}

function BlockerBody({ card }: { card: Extract<ApiLoopCard, { type: 'blocker' }> }) {
  return (
    <>
      <p className="ck-loop-explanation" data-testid="cockpit-loop-card-explanation">{card.human_explanation}</p>
      <dl className="ck-loop-body">
        <Row k="为什么 · Why">{card.why_it_matters}</Row>
        <Row k="你可以 · You can"><List items={card.recovery_actions} /></Row>
        <Row k="建议 · Recommended">{card.recommended_action}</Row>
      </dl>
    </>
  )
}

function PrReadyBody({ card, onRework }: { card: Extract<ApiLoopCard, { type: 'pr_ready' }>; onRework?: (() => void) | undefined }) {
  return (
    <>
      <dl className="ck-loop-body">
        <Row k="摘要 · Summary">{card.summary}</Row>
        <Row k="Draft PR">
          {card.pr_url
            ? <a href={card.pr_url} target="_blank" rel="noreferrer">{card.pr_url}</a>
            : '尚未创建真实 PR · No draft PR has been created yet.'}
        </Row>
        <Row k="改动 · Changed">
          {card.files_changed.length > 0 ? <List items={card.files_changed} /> : '没有记录到文件改动 · No file changes recorded.'}
        </Row>
        <Row k="检查 · Checks">
          {card.tests.length > 0 ? <List items={card.tests} /> : '还没有检查记录 · No checks recorded yet.'}
        </Row>
        <Row k="评审 · Review">{card.validator_verdict ?? '结果评审还没有结论 · No review verdict yet.'}</Row>
        <Row k="风险 · Risk">{RISK_LABELS[card.risk]}</Row>
        <Row k="合并 · Merge">{card.merge_policy}</Row>
      </dl>
      <div className="ck-loop-actions">
        <button
          type="button"
          className="ck-btn ck-loop-rework"
          disabled={!card.rework_button.enabled || !onRework}
          onClick={onRework}
        >
          {card.rework_button.label}
        </button>
      </div>
    </>
  )
}

export function LoopCard({ card, onRework }: { card: ApiLoopCard; onRework?: () => void }) {
  return (
    <section
      className={`ck-loop-card type-${card.type}`}
      data-testid="cockpit-loop-card"
      data-card-type={card.type}
      data-user-state={card.machine.user_state}
      data-machine-stage={card.machine.stage}
      data-hold-code={card.machine.hold_code ?? ''}
      data-pr-gate-code={card.machine.pr_gate_code ?? ''}
    >
      <div className="ck-loop-head">
        <span className={`ck-loop-type type-${card.type}`}>{TYPE_LABELS[card.type]}</span>
        <strong className="ck-loop-title">{card.title}</strong>
      </div>
      <div className="ck-loop-next" data-testid="cockpit-loop-card-next-step">
        <span className="k">下一步 · Next</span>
        <span className="v">{card.next_step}</span>
      </div>
      {card.type === 'understanding' && <UnderstandingBody card={card} />}
      {card.type === 'plan' && <PlanBody card={card} />}
      {card.type === 'progress' && <ProgressBody card={card} />}
      {card.type === 'blocker' && <BlockerBody card={card} />}
      {card.type === 'pr_ready' && <PrReadyBody card={card} onRework={onRework} />}
    </section>
  )
}
