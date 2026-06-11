/**
 * v6-P2 — the five-card loop cockpit surface (WORKBOOK_v6 GR#11).
 * overnight-p3 — upgraded from "state display" to operator console: a new user
 * must know what the system is doing and what to do next WITHOUT logs.
 *
 * Renders exactly ONE of the five ordinary-user cards derived by the daemon
 * (`overview.operatorView.card`, packages/daemon/src/loop-cards.ts). Three
 * rules from docs/product/LOOP_COMMUNICATION_PROTOCOL.md:
 *  1. Machine codes stay in the data layer — the `machine` sub-object is
 *     exposed ONLY through data-* attributes, never as visible text.
 *  2. Visible text is calm and bilingual.
 *  3. Every card answers "what happens next" via a prominent `next_step`.
 *
 * Operator-console additions (all derived from existing view fields — no
 * schema change; the internal five types / data-card-type stay unchanged):
 *  - card titles use the operator vocabulary 理解/计划/构建/验证/合并
 *    (Understand / Plan / Build / Verify / PR·Merge); `progress` splits
 *    VISUALLY into Build vs Verify via machine.stage (title only);
 *  - an agent strip (cockpit-card-agents) shows who is working;
 *  - the daemon's primaryAction renders ON the card (cockpit-card-action),
 *    wired through the SAME handler plumbing as the guidance buttons;
 *  - evidence/files render as clickable-looking entries (cockpit-card-evidence);
 *  - PR-gate decisions show 为什么/谁说的/下一步 (cockpit-card-pr-gate).
 */
import type { ReactNode } from 'react'
import type { ApiBlockerLoopCard, ApiLoopCard, ApiPrReadyLoopCard } from '../../api.js'

/** Structural mirror of the daemon's OperatorActionView — id + label is enough. */
export interface LoopCardAction {
  id: string
  label: string
  disabled?: boolean
}

/** Gate summary passed from the operator view (safetySummary.prGate). */
export interface LoopCardPrGate {
  status: string
  reason?: string
}

// Operator vocabulary (理解/计划/构建/验证/合并). `progress` is resolved by
// stage in operatorStageLabel below; the value here is its Build default.
const TYPE_LABELS: Record<ApiLoopCard['type'], string> = {
  understanding: '理解 · Understand',
  plan: '计划 · Plan',
  progress: '构建 · Build',
  blocker: '需要你 · Needs you',
  pr_ready: '合并 · PR·Merge',
}

/** Verify-phase stages: evidence is being checked/reviewed, not built. */
function isVerifyStage(stage: string): boolean {
  return stage === 'evidence_ready' || stage === 'validating' || stage.startsWith('validators')
}

/** Visible card title in the operator vocabulary — title only, no schema change. */
export function operatorStageLabel(card: Pick<ApiLoopCard, 'type' | 'machine'>): string {
  if (card.type === 'progress' && isVerifyStage(card.machine.stage)) return '验证 · Verify'
  return TYPE_LABELS[card.type]
}

export type LoopCardAgent = 'claude' | 'codex' | 'gemini' | 'github' | 'none'

const AGENTS: Array<{ id: Exclude<LoopCardAgent, 'none'>; label: string }> = [
  { id: 'claude', label: 'Claude · 澄清/规划/审查' },
  { id: 'codex', label: 'Codex · 编码' },
  { id: 'gemini', label: 'Gemini · 终审' },
  { id: 'github', label: 'GitHub · PR' },
]

/** Who is working right now — derived from card type + machine.stage (+ last activity phase). */
export function activeAgentForCard(card: Pick<ApiLoopCard, 'type' | 'machine'>, lastActivityPhase?: string): LoopCardAgent {
  switch (card.type) {
    case 'understanding':
    case 'plan':
      return 'claude'
    case 'progress':
      return isVerifyStage(card.machine.stage) ? 'gemini' : 'codex'
    case 'pr_ready':
      return 'github'
    case 'blocker':
      if (lastActivityPhase === 'planning') return 'claude'
      if (lastActivityPhase === 'executing') return 'codex'
      return 'none'
  }
}

function AgentStrip({ card, lastActivityPhase }: { card: ApiLoopCard; lastActivityPhase?: string | undefined }) {
  const active = activeAgentForCard(card, lastActivityPhase)
  return (
    <div className="ck-loop-agents" data-testid="cockpit-card-agents" data-active-agent={active}>
      {AGENTS.map((a) => (
        <span key={a.id} className={`ck-loop-agent${a.id === active ? ' active' : ''}`} data-agent={a.id}>
          {a.label}
        </span>
      ))}
    </div>
  )
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

/** Evidence/files as clickable-looking, read-only entries (cockpit-card-evidence). */
function EvidenceList({ items }: { items: string[] }) {
  return (
    <ul className="ck-loop-list ck-loop-evidence">
      {items.map((path, i) => (
        <li key={i}>
          <span className="ck-evidence-link" data-testid="cockpit-card-evidence" data-evidence-path={path} role="link" tabIndex={0}>
            {path}
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * PR-gate transparency (为什么 · 谁说的 · 下一步) for cards whose state was
 * decided by the PR gate. A HOLD blocker is NOT a gate decision — the hold
 * explains itself. Raw codes never render; `who` is derived calm wording.
 */
function PrGateSection({ card, prGate }: { card: ApiBlockerLoopCard | ApiPrReadyLoopCard; prGate?: LoopCardPrGate | undefined }) {
  const code = card.machine.pr_gate_code
  const gateDecided = card.type === 'blocker'
    ? card.machine.hold_code === null && code !== null
    : code !== null || Boolean(prGate)
  if (!gateDecided) return null
  const who = code && code.startsWith('GEMINI')
    ? 'Gemini（证据终审） · Gemini, the evidence-only reviewer'
    : '安全门（系统守护） · The safety gate'
  const why = card.type === 'blocker'
    ? card.human_explanation
    : prGate?.reason?.trim() || card.summary
  return (
    <dl className="ck-loop-body ck-loop-prgate" data-testid="cockpit-card-pr-gate">
      <Row k="为什么 · Why">{why}</Row>
      <Row k="谁说的 · Who">{who}</Row>
      <Row k="下一步 · Next">{card.next_step}</Row>
    </dl>
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

const RISK_LABELS: Record<'low' | 'medium' | 'high', string> = {
  low: '低 · low',
  medium: '中 · medium',
  high: '高 · high',
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
          ? <EvidenceList items={card.evidence_links} />
          : '证据生成后会列在这里 · Evidence appears here once produced.'}
      </Row>
    </dl>
  )
}

function BlockerBody({ card, prGate }: { card: Extract<ApiLoopCard, { type: 'blocker' }>; prGate?: LoopCardPrGate | undefined }) {
  return (
    <>
      <p className="ck-loop-explanation" data-testid="cockpit-loop-card-explanation">{card.human_explanation}</p>
      <dl className="ck-loop-body">
        <Row k="为什么 · Why">{card.why_it_matters}</Row>
        <Row k="你可以 · You can">
          <ul className="ck-loop-list ck-loop-recovery" data-testid="cockpit-card-recovery">
            {card.recovery_actions.map((item, i) => {
              const recommended = item === card.recommended_action
              return (
                <li key={i} className={recommended ? 'recommended' : ''} data-recommended={recommended ? 'true' : 'false'}>
                  {recommended ? <strong>{item}</strong> : item}
                  {recommended && <span className="ck-loop-recommended-tag">推荐 · recommended</span>}
                </li>
              )
            })}
          </ul>
        </Row>
      </dl>
      <PrGateSection card={card} prGate={prGate} />
    </>
  )
}

function PrReadyBody({ card, onRework, prGate }: {
  card: Extract<ApiLoopCard, { type: 'pr_ready' }>
  onRework?: (() => void) | undefined
  prGate?: LoopCardPrGate | undefined
}) {
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
          {card.files_changed.length > 0 ? <EvidenceList items={card.files_changed} /> : '没有记录到文件改动 · No file changes recorded.'}
        </Row>
        <Row k="检查 · Checks">
          {card.tests.length > 0 ? <List items={card.tests} /> : '还没有检查记录 · No checks recorded yet.'}
        </Row>
        <Row k="评审 · Review">{card.validator_verdict ?? '结果评审还没有结论 · No review verdict yet.'}</Row>
        <Row k="风险 · Risk">{RISK_LABELS[card.risk]}</Row>
        <Row k="合并 · Merge">{card.merge_policy}</Row>
      </dl>
      <PrGateSection card={card} prGate={prGate} />
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

export function LoopCard({ card, onRework, action, onAction, busy, prGate, lastActivityPhase, viewerIsOwner }: {
  card: ApiLoopCard
  onRework?: () => void
  /** The operator view's primaryAction, rendered ON the card. */
  action?: LoopCardAction | undefined
  /** Existing Cockpit handler plumbing — the card never duplicates logic. */
  onAction?: ((action: LoopCardAction) => void) | undefined
  busy?: boolean | undefined
  prGate?: LoopCardPrGate | undefined
  lastActivityPhase?: string | undefined
  /** cloudhull-c5 — false when the stored display name is not the owner; the
   *  plan/pr_ready decision cards then show calm waiting-for-owner text.
   *  Default true (single-user / owner viewers see no change). */
  viewerIsOwner?: boolean | undefined
}) {
  // Only the two owner-gated decision cards carry the waiting note.
  const waitingForOwner = viewerIsOwner === false && (card.type === 'plan' || card.type === 'pr_ready')
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
        <span className={`ck-loop-type type-${card.type}`}>{operatorStageLabel(card)}</span>
        <strong className="ck-loop-title">{card.title}</strong>
      </div>
      <AgentStrip card={card} lastActivityPhase={lastActivityPhase} />
      <div className="ck-loop-next" data-testid="cockpit-loop-card-next-step">
        <span className="k">下一步 · Next</span>
        <span className="v">{card.next_step}</span>
      </div>
      {waitingForOwner && (
        <div className="ck-loop-next ck-loop-waiting-owner" data-testid="cockpit-waiting-for-owner">
          <span className="k">等待 Owner · waiting for owner</span>
          <span className="v">这一步由 Owner 在控制台确认；你的提交和回答都会保留 · The owner confirms this step in the cockpit; your submissions and answers are kept.</span>
        </div>
      )}
      {action && onAction && (
        <div className="ck-loop-actions">
          <button
            type="button"
            // Primary LOOK via .ck-loop-action, but NOT the .primary class:
            // the quality smoke pins "exactly one .ck-btn.primary per stage"
            // (the guidance row); the card mirrors that same single action.
            className="ck-btn ck-loop-action"
            data-testid="cockpit-card-action"
            data-action-id={action.id}
            disabled={Boolean(action.disabled) || Boolean(busy)}
            onClick={() => onAction(action)}
          >
            {action.label}
          </button>
        </div>
      )}
      {card.type === 'understanding' && <UnderstandingBody card={card} />}
      {card.type === 'plan' && <PlanBody card={card} />}
      {card.type === 'progress' && <ProgressBody card={card} />}
      {card.type === 'blocker' && <BlockerBody card={card} prGate={prGate} />}
      {card.type === 'pr_ready' && <PrReadyBody card={card} onRework={onRework} prGate={prGate} />}
    </section>
  )
}
