/**
 * v-ux-1 — non-developer UX state model.
 *
 * Pure mapping from the internal mission stage + hold/gate codes to a small
 * human vocabulary. North star: this cockpit is for NON-developers — raw HTTP
 * codes, validator codes, and stack traces must never reach the primary chat
 * flow. This module owns the translation; everything it returns is safe to
 * render verbatim in the conversation.
 */

export type UserState =
  | 'understanding'
  | 'needs_more_context'
  | 'planning'
  | 'ready_to_execute'
  | 'executing'
  | 'testing'
  | 'evaluating'
  | 'blocked'
  | 'waiting_for_approval'
  | 'completed'

export interface UserStateView {
  state: UserState
  label: string
  labelZh: string
  explanation: string
}

export interface DeriveUserStateInput {
  /** OperatorMissionStage-like string; unknown values fall back safely. */
  stage: string
  activeHoldCodes: string[]
  validatorStatus?: string | undefined
  prGate?: { status: string; code?: string | undefined } | undefined
  /** Pending clarification questions; drives needs_more_context. */
  pendingQuestionCount?: number | undefined
}

const LABELS: Record<UserState, { label: string; labelZh: string }> = {
  understanding: { label: 'Understanding your goal', labelZh: '正在理解你的目标' },
  needs_more_context: { label: 'Needs your input', labelZh: '需要你补充信息' },
  planning: { label: 'Drafting the plan', labelZh: '正在制定方案' },
  ready_to_execute: { label: 'Ready to start', labelZh: '可以开始执行' },
  executing: { label: 'Working on it', labelZh: '正在执行' },
  testing: { label: 'Checking the work', labelZh: '正在检查结果' },
  evaluating: { label: 'Reviewing the result', labelZh: '正在评审结果' },
  blocked: { label: 'Needs your attention', labelZh: '需要你处理' },
  waiting_for_approval: { label: 'Waiting for your go-ahead', labelZh: '等待你的确认' },
  completed: { label: 'Done', labelZh: '已完成' },
}

/** Codes where "blocked" is a deliberate safety gate, not a failure. */
const SAFETY_GATE_CODES = new Set(['GEMINI_NOT_PASS', 'REMOTE_WRITES_DISABLED', 'REPO_NOT_WHITELISTED'])

/** Translate a blocking hold/gate code into a HUMAN sentence (no raw codes). */
export function explainBlockingCode(code: string | undefined): string {
  if (code && code.startsWith('HOLD-BUDGET')) {
    return '今日预算已用完，明天自动恢复或调高预算 · Today’s budget is used up; it resets tomorrow, or you can raise the limit.'
  }
  if (code && code.startsWith('HOLD-REVIEW-LOOP')) {
    return '自动修复多次未通过，需要人看一眼 · Automatic repair did not pass after several tries; a person should take a look.'
  }
  if (code && code.startsWith('HOLD-PLANNER-AUTH')) {
    return '本地 Claude 登录已过期或额度用尽：在终端运行 claude login 重新登录，或检查订阅额度 · The local Claude session needs re-login or has run out of credit — run "claude login" in a terminal, or check your subscription credit.'
  }
  if (code && code.startsWith('HOLD-SESSION-POOL')) {
    return '本地 AI 引擎未就绪 · The local AI engine is not ready yet.'
  }
  if (!code || SAFETY_GATE_CODES.has(code)) {
    return '改动已完成并通过检查，等待你确认后才会对外发布 · The work is finished and checked; nothing is published until you confirm.'
  }
  return '系统在这一步暂停，等你看一眼后再继续 · The system paused here and will continue once you take a look.'
}

function view(state: UserState, explanation: string): UserStateView {
  return { state, ...LABELS[state], explanation }
}

export function deriveUserState(input: DeriveUserStateInput): UserStateView {
  const stage = input.stage
  const holdCode = input.activeHoldCodes.find((code) => code.startsWith('HOLD-'))
  if (holdCode) return view('blocked', explainBlockingCode(holdCode))

  switch (stage) {
    case 'intake':
    case 'new':
    case 'understanding':
    case 'brainstorming':
      return view('understanding', 'AI 正在阅读你的目标，还没有改任何东西 · The AI is reading your goal; nothing has been changed yet.')
    case 'clarifying':
      return view('needs_more_context', '还有几个问题需要你确认，回答后才能继续 · A few questions need your answers before work can continue.')
    case 'understanding_ready':
      if ((input.pendingQuestionCount ?? 0) > 0) {
        return view('needs_more_context', '还有待确认的问题，回答后就能生成方案 · There are outstanding questions; answering them unlocks the plan.')
      }
      return view('planning', '理解已经足够，正在准备具体方案 · Understanding is good enough; the plan is being prepared.')
    case 'planning':
    case 'generating_roadmap':
    case 'roadmap_generating':
      return view('planning', '正在把你的目标整理成可执行的方案 · Your goal is being turned into a concrete, reviewable plan.')
    case 'roadmap_ready':
    case 'pending_approval':
      return view('waiting_for_approval', '方案已准备好，确认后才会开始动手 · The plan is ready; nothing runs until you approve it.')
    case 'approved':
      return view('ready_to_execute', '方案已批准，点击开始后才会动手 · The plan is approved; work starts when you say go.')
    case 'running':
      return view('executing', 'AI 正在按方案干活，进度会持续更新 · The AI is working through the plan; progress keeps updating here.')
    case 'evidence_ready':
    case 'validating':
      return view('testing', '正在检查和验证刚完成的改动 · The finished work is being checked and verified.')
    case 'validators_ready':
      return view('evaluating', '独立评审已完成，结论已经回到对话里 · Independent review is complete; the verdict is in the conversation.')
    case 'validators_missing':
      // Honest, never an error: a missing reviewer is a configuration fact.
      return view('evaluating', '结果评审尚未配置 · result review not configured')
    case 'pr_blocked':
      return view('blocked', explainBlockingCode(input.prGate?.code))
    case 'pr_ready':
      return view('waiting_for_approval', '检查已完成，等待你确认下一步 · Checks are done; waiting for your confirmation to proceed.')
    case 'pr_created':
    case 'learned':
      return view('completed', '本轮工作已完成，结果已经安全保存 · This round of work is complete and safely recorded.')
    case 'failed':
      return view('blocked', '这次尝试没有成功，现场已经保护好，可以随时重新开始 · This attempt did not finish; everything is safe and you can start over anytime.')
    case 'cancelled':
      return view('blocked', '任务已按你的要求停止，可以随时重新开始 · The mission was stopped at your request; start again whenever you like.')
    default:
      return view('understanding', 'AI 正在跟进你的任务 · The AI is following up on your mission.')
  }
}
