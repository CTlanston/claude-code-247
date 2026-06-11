/**
 * v6-P1 — five-card loop communication protocol (WORKBOOK_v6 GR#11).
 *
 * `deriveLoopCard` is a PURE mapping from operator-view-like fields to exactly
 * ONE of five card types: understanding / plan / progress / blocker /
 * pr_ready. The ordinary user never sees anything else.
 *
 * Three rules (docs/product/LOOP_COMMUNICATION_PROTOCOL.md):
 *  1. Machine codes (HOLD-*, gate codes, raw stages) live ONLY in the
 *     `machine` sub-object — the data layer for automation/debugging.
 *  2. Visible text is calm and bilingual; it reuses the user-state phrasing.
 *  3. Every card answers "what happens next" via a non-empty `next_step`.
 */

import type { UserStateView } from './user-state.js'

export type LoopCardType = 'understanding' | 'plan' | 'progress' | 'blocker' | 'pr_ready'

/** Data layer: raw codes for automation. Never rendered as primary text. */
export interface LoopCardMachine {
  user_state: string
  stage: string
  hold_code: string | null
  pr_gate_code: string | null
}

interface LoopCardBase {
  /** Calm bilingual title, reused from the user-state vocabulary. */
  title: string
  /** Rule 3 — every card answers "what happens next". Always non-empty. */
  next_step: string
  machine: LoopCardMachine
}

export interface UnderstandingLoopCard extends LoopCardBase {
  type: 'understanding'
  user_goal: string
  interpreted_goal: string
  out_of_scope: string[]
  confidence: number
  questions: Array<{ id: string; question: string }>
  default_assumptions: string[]
}

export interface PlanLoopCard extends LoopCardBase {
  type: 'plan'
  objective: string
  phases: string[]
  acceptance_criteria: string[]
  risk_level: 'low' | 'medium' | 'high'
  estimated_calls: number
  requires_approval: boolean
}

export interface ProgressLoopCard extends LoopCardBase {
  type: 'progress'
  current_phase: string
  current_action: string
  evidence_links: string[]
  tests_run: string[]
}

export interface BlockerLoopCard extends LoopCardBase {
  type: 'blocker'
  human_explanation: string
  why_it_matters: string
  recovery_actions: string[]
  recommended_action: string
}

export interface PrReadyLoopCard extends LoopCardBase {
  type: 'pr_ready'
  pr_url: string | null
  summary: string
  files_changed: string[]
  tests: string[]
  validator_verdict: string | null
  risk: 'low' | 'medium' | 'high'
  /** GR#10 — human merge only; the system never merges. */
  merge_policy: string
  rework_button: { enabled: boolean; label: string }
}

export type LoopCard =
  | UnderstandingLoopCard
  | PlanLoopCard
  | ProgressLoopCard
  | BlockerLoopCard
  | PrReadyLoopCard

export interface LoopCardQuestionInput {
  id: string
  question: string
  options?: Array<{ label: string; recommended?: boolean }>
}

/** View-like input: a structural subset of OperatorMissionView + mission/session bits. */
export interface DeriveLoopCardInput {
  userState: UserStateView
  stage: string
  confidence: number
  summary: string
  nextAction: string
  prompt?: string | null
  missionTitle?: string | null
  githubPrUrl?: string | null
  understanding: { roundsCompleted: number; questions: LoopCardQuestionInput[]; readyReason?: string }
  loopSummary: {
    whatChanged: string[]
    testsRan: string[]
    agents: string[]
    validatorSaid: string | null
    whyStoppedOrContinuing: string
  }
  lastActivity: { atIso: string | null; agoMs: number | null; phase: string }
  safetySummary: {
    remoteWrites: 'enabled' | 'disabled'
    prGate?: { status: string; code?: string | undefined; reason?: string | undefined } | undefined
  }
  projectPulse?: { progress: Array<{ label: string }>; evidence: Array<{ path: string }> } | undefined
  activeHolds?: Array<{ code: string; reason?: string | undefined; nextAction?: string | undefined }> | undefined
  /** Per-mission headless budget cap (GR#1); defaults to 15 when unknown. */
  estimatedCalls?: number | undefined
}

/** GR#10 — fixed wording; the system never merges. */
export const HUMAN_MERGE_ONLY_POLICY =
  '只有你能 merge：系统止于 Draft PR，永不自动合并 · Human merge only: the system stops at the draft PR and never merges.'

const REWORK_LABEL = '不满意？让 AI 返工 · Not satisfied? Ask for rework.'

function bilingualTitle(userState: UserStateView): string {
  return `${userState.labelZh} · ${userState.label}`
}

function riskFromPolicy(remoteWrites: 'enabled' | 'disabled'): 'low' | 'medium' | 'high' {
  // Deterministic, honest derivation: with remote writes disabled nothing can
  // leave the machine (low); with the gate open a draft PR can be pushed (medium).
  return remoteWrites === 'disabled' ? 'low' : 'medium'
}

/** Bilingual "why this pause protects you" wording per blocking-code category. No raw codes. */
function whyItMatters(code: string | null): string {
  if (code && code.startsWith('HOLD-BUDGET')) {
    return '预算护栏防止系统在你不知情时超额消耗调用额度 · The budget guard stops the system from silently burning through your call allowance.'
  }
  if (code && code.startsWith('HOLD-REVIEW-LOOP')) {
    return '反复返工说明这条路走不通，继续自动重试只会浪费额度 · Repeated rework means this path is not converging; more automatic retries would only waste your allowance.'
  }
  if (code && code.startsWith('HOLD-PLANNER-AUTH')) {
    return '规划引擎的本地登录已失效，继续自动重试只会反复失败；先恢复登录是最快的恢复路径 · The planner’s local login is no longer valid; automatic retries would keep failing, so restoring the login is the fastest way back.'
  }
  if (code && (code.startsWith('HOLD-SESSION-POOL') || code.startsWith('HOLD-TARGET-REPO'))) {
    return '在环境就绪之前动手只会产生假进度，系统选择诚实地等待 · Acting before the environment is ready would only fake progress; the system honestly waits instead.'
  }
  return '在不确定的时候暂停，比悄悄做错更安全；没有你的确认，任何东西都不会对外发布 · Pausing when unsure is safer than quietly doing the wrong thing; nothing is published without your confirmation.'
}

/** Bilingual recovery actions per blocking-code category. No raw codes. */
function recoveryActions(code: string | null): string[] {
  if (code && code.startsWith('HOLD-BUDGET')) {
    return [
      '等到明天额度自动恢复 · Wait for the allowance to reset tomorrow.',
      '在设置里调高今日预算后继续 · Raise today’s budget in settings, then continue.',
    ]
  }
  if (code && code.startsWith('HOLD-REVIEW-LOOP')) {
    return [
      '亲自看一眼最近的改动和检查结果 · Take a look at the latest change and check results yourself.',
      '把任务拆小或补充更明确的要求后重新开始 · Restart with a smaller task or clearer requirements.',
    ]
  }
  if (code && code.startsWith('HOLD-PLANNER-AUTH')) {
    return [
      '在终端运行 claude login 重新登录本地 Claude · Run `claude login` in a terminal to sign the local Claude CLI back in.',
      '在 Claude CLI 里输入 /status 检查订阅额度 · Check subscription credit with /status inside the Claude CLI.',
      '可选：设置 AEDEV_PLANNER_FALLBACK=codex 让本地 Codex 暂代规划（永不使用付费 API） · Optional: set AEDEV_PLANNER_FALLBACK=codex to let the local Codex CLI plan instead (never a paid API).',
    ]
  }
  if (code && (code.startsWith('HOLD-SESSION-POOL') || code.startsWith('HOLD-TARGET-REPO'))) {
    return [
      '检查本地 AI 引擎和目标仓库是否就绪 · Check that the local AI engine and the target repository are ready.',
      '就绪后重新开始这一步 · Start this step again once things are ready.',
    ]
  }
  return [
    '查看这张卡的说明，确认是否继续 · Read this card’s explanation and confirm whether to continue.',
    '随时可以重新开始或调整目标 · You can restart or adjust the goal at any time.',
  ]
}

function understandingCard(input: DeriveLoopCardInput, machine: LoopCardMachine): UnderstandingLoopCard {
  const questions = input.understanding.questions.map((q) => ({ id: q.id, question: q.question }))
  const default_assumptions = input.understanding.questions
    .map((q) => {
      const recommended = q.options?.find((o) => o.recommended)
      return recommended
        ? `不回答时默认采用：${q.question} → ${recommended.label} · If unanswered, the default is "${recommended.label}".`
        : null
    })
    .filter((x): x is string => x !== null)
  const next_step = questions.length > 0
    ? '回答上面的问题，AI 才能继续生成方案 · Answer the questions above so the plan can continue.'
    : '稍等片刻，AI 正在确认理解，随后会给出方案 · Hang on — understanding is being confirmed; a plan comes next.'
  return {
    type: 'understanding',
    title: bilingualTitle(input.userState),
    user_goal: input.prompt?.trim() || input.missionTitle?.trim() || '（目标待补充 · goal not provided yet）',
    interpreted_goal: input.summary,
    out_of_scope: [], // never fabricated; populated only once explicitly confirmed
    confidence: input.confidence,
    questions,
    default_assumptions,
    next_step,
    machine,
  }
}

function planCard(input: DeriveLoopCardInput, machine: LoopCardMachine): PlanLoopCard {
  const phases = (input.projectPulse?.progress ?? []).map((p) => p.label)
  const acceptance_criteria = input.loopSummary.testsRan.length > 0
    ? input.loopSummary.testsRan
    : ['验收检查会在执行后逐项展示在这里 · Acceptance checks appear here, item by item, once execution runs.']
  const next_step = input.userState.state === 'waiting_for_approval'
    ? '审阅这份方案；你批准后才会开始动手 · Review this plan; work starts only after you approve it.'
    : '方案正在生成，完成后需要你批准 · The plan is being drafted; it will need your approval when ready.'
  return {
    type: 'plan',
    title: bilingualTitle(input.userState),
    objective: input.prompt?.trim() || input.missionTitle?.trim() || input.summary,
    phases,
    acceptance_criteria,
    risk_level: riskFromPolicy(input.safetySummary.remoteWrites),
    estimated_calls: input.estimatedCalls ?? 15,
    requires_approval: true, // GR#10: nothing executes or merges without a human
    next_step,
    machine,
  }
}

function progressCard(input: DeriveLoopCardInput, machine: LoopCardMachine): ProgressLoopCard {
  return {
    type: 'progress',
    title: bilingualTitle(input.userState),
    current_phase: bilingualTitle(input.userState),
    current_action: input.loopSummary.whyStoppedOrContinuing,
    evidence_links: (input.projectPulse?.evidence ?? []).map((e) => e.path),
    tests_run: input.loopSummary.testsRan,
    next_step: input.nextAction,
    machine,
  }
}

function blockerCard(input: DeriveLoopCardInput, machine: LoopCardMachine): BlockerLoopCard {
  const code = machine.hold_code ?? machine.pr_gate_code
  const recovery = recoveryActions(code)
  return {
    type: 'blocker',
    title: bilingualTitle(input.userState),
    // Reuses the user-state phrasing (explainBlockingCode) — never raw codes.
    human_explanation: input.userState.explanation,
    why_it_matters: whyItMatters(code),
    recovery_actions: recovery,
    recommended_action: recovery[0] ?? '看一眼说明后再继续 · Take a look, then continue.',
    next_step: recovery[0] ?? '看一眼说明后再继续 · Take a look, then continue.',
    machine,
  }
}

function prReadyCard(input: DeriveLoopCardInput, machine: LoopCardMachine): PrReadyLoopCard {
  const pr_url = input.githubPrUrl?.trim() || null
  const next_step = pr_url
    ? '去 GitHub 审阅这个 Draft PR；merge 由你亲自点 · Review the draft PR on GitHub; merging is yours to do.'
    : '检查已完成；确认后系统会尝试开 Draft PR（merge 永远由你执行） · Checks are done; on your confirmation the system attempts a draft PR (merging stays yours).'
  return {
    type: 'pr_ready',
    title: bilingualTitle(input.userState),
    pr_url,
    summary: input.summary,
    files_changed: input.loopSummary.whatChanged,
    tests: input.loopSummary.testsRan,
    validator_verdict: input.loopSummary.validatorSaid, // honest: null when no verdict exists
    risk: riskFromPolicy(input.safetySummary.remoteWrites),
    merge_policy: HUMAN_MERGE_ONLY_POLICY,
    rework_button: { enabled: true, label: REWORK_LABEL },
    next_step,
    machine,
  }
}

/**
 * Derive exactly ONE of the five cards from operator-view fields.
 *
 * userState → card type:
 *   understanding | needs_more_context                          → understanding
 *   planning | waiting_for_approval (roadmap, stage ≠ pr_ready) → plan
 *   ready_to_execute | executing | testing | evaluating         → progress
 *   blocked                                                     → blocker
 *   completed | waiting_for_approval at stage pr_ready          → pr_ready
 */
export function deriveLoopCard(input: DeriveLoopCardInput): LoopCard {
  const machine: LoopCardMachine = {
    user_state: input.userState.state,
    stage: input.stage,
    hold_code: input.activeHolds?.[0]?.code ?? null,
    pr_gate_code: input.safetySummary.prGate?.code ?? null,
  }
  switch (input.userState.state) {
    case 'understanding':
    case 'needs_more_context':
      return understandingCard(input, machine)
    case 'planning':
      return planCard(input, machine)
    case 'waiting_for_approval':
      return input.stage === 'pr_ready' ? prReadyCard(input, machine) : planCard(input, machine)
    case 'ready_to_execute':
    case 'executing':
    case 'testing':
    case 'evaluating':
      return progressCard(input, machine)
    case 'blocked':
      return blockerCard(input, machine)
    case 'completed':
      return prReadyCard(input, machine)
  }
}
