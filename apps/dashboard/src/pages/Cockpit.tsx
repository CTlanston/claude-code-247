import { useEffect, useMemo, useState, type CSSProperties } from 'react'
import {
  api,
  ApiError,
  type ApiMissionOverview,
  type ApiOperatorChoice,
  type ApiOperatorMissionView,
  type ApiOperatorMessage,
  type ApiOperatorSession,
  type ApiRepo,
} from '../api.js'
import { useSSE } from '../hooks/useSSE.js'
import { ChatThread } from './cockpit/ChatThread.js'
import { Composer } from './cockpit/Composer.js'
import { ClarificationPopup } from './cockpit/ClarificationPopup.js'
import './cockpit/cockpit.css'

const DEFAULT_PROMPT = 'Brainstorm a low-risk improvement, produce PRD/ADR/roadmap, then execute to the draft PR/evidence gate.'
const SESSION_STORAGE_KEY = 'operatorCockpitSessionId'

function fmtElapsed(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
type GuidanceAction = { label: string; onClick: () => void; disabled: boolean; testId?: string }
type DraftPrResult = { status: string; code?: string; reason?: string; url?: string; number?: number }
interface Guidance {
  kicker: string
  title: string
  body: string
  primary?: GuidanceAction
  secondary?: GuidanceAction
}

const ACTION_TEST_IDS: Record<string, string> = {
  'start-brainstorm': 'cockpit-start-brainstorm',
  'generate-plan': 'cockpit-generate-plan-primary',
  'approve-roadmap': 'cockpit-approve-roadmap',
  'start-execution': 'cockpit-start-execution',
  'check-draft-pr-gate': 'cockpit-check-draft-pr-gate',
  resume: 'cockpit-resume-execution',
  pause: 'cockpit-pause-execution',
  'start-over': 'cockpit-start-over',
}

export function CockpitPage({ onNavigate }: { onNavigate?: (tab: string) => void } = {}) {
  const sse = useSSE('/api/events/stream')
  const [pendingApprovals, setPendingApprovals] = useState(0)
  const [repos, setRepos] = useState<ApiRepo[]>([])
  const [repoId, setRepoId] = useState('')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [title, setTitle] = useState('Operator Cockpit Mission')
  const [session, setSession] = useState<ApiOperatorSession | null>(null)
  const [messages, setMessages] = useState<ApiOperatorMessage[]>([])
  const [overview, setOverview] = useState<ApiMissionOverview | null>(null)
  const [draftPrStatus, setDraftPrStatus] = useState<DraftPrResult | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [errDetail, setErrDetail] = useState<string | null>(null)
  const [note, setNote] = useState('')
  const [skippedClarify, setSkippedClarify] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    api.getRepos().then((r) => {
      setRepos(r)
      setRepoId((current) => current || r[0]?.id || 'unknown')
    }).catch((e: Error) => {
      const human = mapErrorToHuman(e)
      setErr(human.text)
      setErrDetail(human.detail ?? null)
    })
  }, [])

  // Authoritative pending-approval count from the same /approvals source the
  // Approvals page uses (the SSE state event can read 0 when disconnected).
  useEffect(() => {
    const load = () => api.getApprovals().then((a) => setPendingApprovals(a.filter((x) => x.status === 'pending').length)).catch(() => undefined)
    void load()
    const timer = setInterval(load, 4_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    const savedId = localStorage.getItem(SESSION_STORAGE_KEY)
    const load = savedId ? api.getOperatorSession(savedId) : api.getLatestOperatorSession()
    load.then((x) => {
      if (!x.session) return
      setSession(x.session)
      setMessages(x.messages)
      setRepoId((current) => x.session?.repoId ?? current)
      setTitle(x.session.title)
      setPrompt(x.session.prompt)
      localStorage.setItem(SESSION_STORAGE_KEY, x.session.id)
    }).catch(() => {
      if (localStorage.getItem(SESSION_STORAGE_KEY)) {
        setNotice('上次的会话已不可用，已为你重置。Previous session was unavailable — start a new brainstorm.')
      }
      localStorage.removeItem(SESSION_STORAGE_KEY)
    })
  }, [])

  useEffect(() => {
    if (!session?.missionId) return
    const load = () => api.getMissionOverview(session.missionId!).then(setOverview).catch(() => undefined)
    void load()
    const timer = setInterval(load, 2_000)
    return () => clearInterval(timer)
  }, [session?.missionId])

  useEffect(() => {
    if (session?.id) localStorage.setItem(SESSION_STORAGE_KEY, session.id)
  }, [session?.id])

  useEffect(() => {
    if (!session?.id) return
    const shouldPoll = ['brainstorming', 'hold', 'brainstorm_ready', 'roadmap_ready', 'running'].includes(session.status)
    if (!shouldPoll) return
    const load = () => api.getOperatorSession(session.id).then((x) => {
      setSession(x.session)
      setMessages(x.messages)
    }).catch(() => undefined)
    const timer = setInterval(load, 2_000)
    return () => clearInterval(timer)
  }, [session?.id, session?.status])

  const latestHold = useMemo(() => latestHoldMessage(messages), [messages])
  // The latest planner clarification that's neither answered nor skipped — drives
  // the bottom blocking popup (redesign v2, P3/#6).
  const pendingClarify = useMemo(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!
      if (m.role === 'assistant' && m.questions && m.questions.length > 0) {
        const answered = messages.slice(i + 1).some((l) => l.role === 'user' && /已确认|Clarifications/.test(l.content))
        return answered || skippedClarify.has(m.id) ? null : m
      }
    }
    return null
  }, [messages, skippedClarify])

  async function action<T>(label: string, fn: () => Promise<T>, after?: (x: T) => void) {
    setBusy(label)
    setErr(null)
    setErrDetail(null)
    setNotice(actionStartMessage(label))
    try {
      const out = await fn()
      after?.(out)
      if (isHoldResponse(out)) {
        setErr(`${out.hold.code}: ${out.hold.reason}`)
        setNotice('Planner 进入 HOLD，需要先修复本地 CLI/session，或显式开启模板 fallback 后重试。')
      } else {
        setNotice(actionDoneMessage(label))
      }
    } catch (e) {
      // Raw HTTP/gate codes never reach the chat: structured refusals become a
      // normal assistant-style notice, everything else a generic human message.
      const human = mapErrorToHuman(e)
      if (human.kind === 'guidance') {
        setErr(null)
        setNotice(human.text)
      } else {
        setErr(human.text)
        setErrDetail(human.detail ?? null)
        setNotice(null)
      }
    } finally {
      setBusy(null)
    }
  }

  function resetMission() {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setSession(null)
    setMessages([])
    setOverview(null)
    setDraftPrStatus(null)
    setErr(null)
    setErrDetail(null)
    setPrompt(DEFAULT_PROMPT)
    setTitle('Operator Cockpit Mission')
    setNotice('已开始新任务。New mission — describe your goal, then start a brainstorm.')
  }

  function handleChoice(choice: ApiOperatorChoice) {
    if (!session) return
    if (choice.action === 'generate-roadmap') {
      void action('roadmap', () => api.generateRoadmap(session.id), (x) => {
        setSession(x.session)
        setMessages(x.messages)
        if (x.mission) void api.getMissionOverview(x.mission.id).then(setOverview)
      })
    } else if (choice.action === 'ask-questions') {
      void action('ask', () => api.askQuestions(session.id, choice.prompt), (x) => { setSession(x.session); setMessages(x.messages) })
    } else {
      setNotice('在下方补充框输入你的约束，然后点击 Add Note · Type your constraints in the composer below, then Add Note.')
    }
  }

  const guidance = buildGuidance({
    session,
    overview,
    busy,
    messages,
    latestHold,
    sseConnected: sse.connected,
    operatorView: overview?.operatorView,
    onBrainstorm: () => action('create', () => api.createOperatorSession({ repoId, title, prompt }), (x) => { setSession(x.session); setMessages(x.messages); setOverview(null); setDraftPrStatus(null) }),
    onRoadmap: () => session && action('roadmap', () => api.generateRoadmap(session.id), (x) => { setSession(x.session); setMessages(x.messages); if (x.mission) void api.getMissionOverview(x.mission.id).then(setOverview) }),
    onApprove: () => session && action('approve', () => api.approveRoadmap(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onStart: () => session && action('start', () => api.startOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onPause: () => session && action('pause', () => api.pauseOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onResume: () => session && action('resume', () => api.resumeOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onDraftPr: () => session && action('draft-pr', () => api.createDraftPr(session.id), (x) => { setOverview(x.overview); setDraftPrStatus({ status: x.status, code: x.code, reason: x.reason, url: x.pr?.url, number: x.pr?.number }) }),
    onReset: resetMission,
    onStop: () => session?.missionId && action('stop', () => api.stopOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
  })

  const hasSession = Boolean(session)
  const pendingCount = Math.max(pendingApprovals, sse.pendingApprovals)
  const operatorView = overview?.operatorView
  const plannerProvider = operatorView?.providerSummary.planner
  const workerProvider = operatorView?.providerSummary.worker
  const stageForDom = operatorView?.stage ?? (session?.status === 'brainstorming' ? 'brainstorming' : session?.missionId ? 'roadmap_ready' : 'new')
  const progressPercent = operatorView?.progressPercent ?? Math.round((overview?.progress ?? 0) * 100)
  const nowRunning = busy ? actionName(busy) : operatorView?.nextAction ?? guidance.title
  // v-ux-1 — client-side tick so "Last activity" and the in-flight elapsed
  // counter keep moving even when no new event arrives (phases never look frozen).
  const [nowTs, setNowTs] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNowTs(Date.now()), 1_000)
    return () => clearInterval(timer)
  }, [])
  const lastActivity = operatorView?.lastActivity
  const lastActivityAgoMs = lastActivity?.atIso
    ? Math.max(0, nowTs - Date.parse(lastActivity.atIso))
    : lastActivity?.agoMs ?? null
  const phaseInFlight = lastActivity?.phase === 'planning' || lastActivity?.phase === 'executing'

  return (
    <div
      className="cockpit"
      data-testid="cockpit-root"
      data-stage={stageForDom}
      data-provider-planner={plannerProvider?.mode ?? plannerProvider?.name ?? 'unknown'}
      data-provider-worker={workerProvider?.mode ?? workerProvider?.name ?? 'unknown'}
      data-pr-gate-code={operatorView?.safetySummary.prGate?.code ?? ''}
    >
      <header className="ck-topstrip" data-testid="cockpit-status-strip">
        <span className="ck-stat ck-stage" data-testid="mission-stage" data-stage={stageForDom}>
          <span className={`dot${sse.connected ? '' : ' off'}`} />
          <span className="k">Stage</span>
          <span className="v">{operatorView?.stageLabel ?? guidance.kicker}</span>
        </span>
        <span className="ck-stat ck-now" data-testid="cockpit-now-running">
          <span className="k">Now</span>
          <span className="v">
            {nowRunning}
            {phaseInFlight && lastActivityAgoMs != null && (
              <span data-testid="cockpit-now-elapsed">{` · ${fmtElapsed(lastActivityAgoMs)}`}</span>
            )}
          </span>
        </span>
        {lastActivity && (
          <span className="ck-stat" data-testid="cockpit-last-activity" title="距上次活动 · Time since the last recorded event">
            <span className="k">Last activity</span>
            <span className="v">{lastActivityAgoMs != null ? `${fmtElapsed(lastActivityAgoMs)} ago` : '—'}</span>
          </span>
        )}
        <span className="ck-stat ck-progress" data-testid="cockpit-progress">
          <span className="k">Progress</span>
          <span className="v">{progressPercent}%</span>
          <span className="ck-progress-dot" style={{ '--p': `${Math.max(0, Math.min(100, progressPercent))}%` } as CSSProperties} />
        </span>
        <span className="ck-strip-spacer" />
        {typeof operatorView?.headlessCallsToday === 'number' && (
          <span className="ck-stat" data-testid="cockpit-headless-calls" title="Metered headless claude calls today (Agent SDK credit) · 今日 headless 调用">
            <span className="k">calls</span>
            <span className="v">{operatorView.headlessCallsToday}</span>
          </span>
        )}
        <span className="ck-stat provider-shadow" data-testid="provider-planner" aria-label="planner provider">{plannerProvider ? `${plannerProvider.name} · ${plannerProvider.mode}` : '—'}</span>
        <span className="ck-stat provider-shadow" data-testid="provider-worker" aria-label="worker provider">{workerProvider ? `${workerProvider.name} · ${workerProvider.mode}` : '—'}</span>
        <button className="ck-stat approvals" onClick={() => onNavigate?.('approvals')} title="Open approvals · 打开审批">
          <span className="k">approvals</span><span className="v">{pendingCount}</span>
        </button>
      </header>

      <div className="cockpit-shell conversation-only">
        <div className="ck-main">
          <div className="ck-topbar">
            <div className="ck-coach">
              <div className="ck-coach-title">{guidance.title}</div>
              <div className="ck-coach-body">{guidance.body}</div>
            </div>
          </div>

          {err && (
            <div className="ck-banner error">
              {err}
              {errDetail && (
                <details className="ck-err-detail">
                  <summary>详情 · details</summary>
                  <pre style={{ whiteSpace: 'pre-wrap', margin: '4px 0 0' }}>{errDetail}</pre>
                </details>
              )}
            </div>
          )}
          {overview?.activeHolds && overview.activeHolds.length > 0 && (
            <div className="ck-banner error">
              {overview.activeHolds.map((h) => (
                <div key={h.id}><strong>Active HOLD · {h.code}</strong> — {h.reason}{h.nextAction ? ` · Next: ${h.nextAction}` : ''}</div>
              ))}
            </div>
          )}
          {!err && !(overview?.activeHolds?.length) && latestHold && session?.status === 'hold' && <div className="ck-banner error">Active HOLD · {latestHold}</div>}
          {(guidance.primary || guidance.secondary) && (
            <div className="ck-composer-actions" data-testid="cockpit-primary-actions" style={{ marginBottom: 8 }}>
              {guidance.primary && <button data-testid={guidance.primary.testId} className="ck-btn primary" disabled={guidance.primary.disabled || Boolean(busy)} onClick={guidance.primary.onClick}>{guidance.primary.label}</button>}
              {guidance.secondary && <button data-testid={guidance.secondary.testId} className="ck-btn" disabled={guidance.secondary.disabled || Boolean(busy)} onClick={guidance.secondary.onClick}>{guidance.secondary.label}</button>}
            </div>
          )}
          {draftPrStatus && (draftPrStatus.status === 'created' && draftPrStatus.url ? (
            <div className="ck-pr-outcome created" data-testid="cockpit-pr-gate-card" data-pr-gate-status="created">
              <strong>✓ Draft PR created · 草稿 PR 已创建</strong>
              <a href={draftPrStatus.url} target="_blank" rel="noreferrer">{draftPrStatus.url}</a>
            </div>
          ) : (
            <div className="ck-pr-outcome blocked" data-testid="cockpit-pr-gate-card" data-pr-gate-status="blocked" data-pr-gate-code={draftPrStatus.code ?? ''}>
              <strong>{draftPrBlockedHeading(draftPrStatus.code)}</strong>
              {draftPrStatus.reason && <span>{draftPrStatus.reason}</span>}
              <span className="ck-pr-remedy">{draftPrRemediation(draftPrStatus.code)}</span>
              <span className="ck-pr-remedy">Safety check: no branch push, no PR creation, no merge · 安全确认：没有 push、没有创建 PR、没有合并。</span>
            </div>
          ))}
          {operatorView?.testMode && (
            <div className="ck-banner testmode" data-testid="cockpit-test-mode">
              Test mode: mock planner/worker, no external model, no remote writes · 测试模式：mock planner/worker，不调用外部模型，不写远程。
            </div>
          )}
          {notice && <div className="ck-banner notice">{notice}</div>}

          <ChatThread
            messages={messages}
            busy={busy}
            canChoose={false}
            onChoice={handleChoice}
            onAnswer={(answers) => session && action('answer', () => api.answerQuestions(session.id, answers), (x) => { setSession(x.session); setMessages(x.messages) })}
            footer={<><LoopSummaryCard view={operatorView} /><IndependentReviewBlock overview={overview} /><ProcessBlock overview={overview} busy={busy} /></>}
          />

          {pendingClarify && pendingClarify.questions && pendingClarify.questions.length > 0 && (
            <ClarificationPopup
              questions={pendingClarify.questions}
              busy={busy}
              onSubmit={(answers) => session && action('answer', () => api.answerQuestions(session.id, answers), (x) => { setSession(x.session); setMessages(x.messages) })}
              onSkip={() => setSkippedClarify((s) => new Set(s).add(pendingClarify.id))}
            />
          )}

          <Composer
            mode={hasSession ? 'session' : 'new'}
            busy={busy}
            draft={hasSession ? note : prompt}
            onDraftChange={hasSession ? setNote : setPrompt}
            repos={repos}
            repoId={repoId}
            onRepoChange={setRepoId}
            title={title}
            onTitleChange={setTitle}
            onBrainstorm={() => action('create', () => api.createOperatorSession({ repoId, title, prompt }), (x) => { setSession(x.session); setMessages(x.messages); setOverview(null); setDraftPrStatus(null) })}
            onAddNote={() => session && note.trim() && action('message', () => api.addOperatorMessage(session.id, note), (x) => { setMessages(x.messages); setNote('') })}
            onAsk={() => session && action('ask', () => api.askQuestions(session.id), (x) => { setSession(x.session); setMessages(x.messages) })}
          />
        </div>
      </div>
    </div>
  )
}

/**
 * Gate-card heading is human-first (ux-2 follow-up): known machine codes get
 * the calm bilingual phrasing the daemon's user-state model uses; the raw
 * code stays available to tooling via the data-pr-gate-code attribute only.
 */
export function draftPrBlockedHeading(code?: string): string {
  if (code === 'GEMINI_NOT_CONFIGURED') {
    return 'Draft PR blocked · 被安全门拦截 · 结果评审尚未配置 · result review not configured'
  }
  return `Draft PR blocked · 被安全门拦截${code ? ` · ${code}` : ''}`
}

/** Honest, actionable remediation for a blocked Draft PR (redesign v2, P4 / #4). */
function draftPrRemediation(code?: string): string {
  if (code === 'GEMINI_NOT_CONFIGURED') {
    return 'Gemini hard gate 尚未运行 · Configure/run Gemini validation first; missing validation is never counted as pass.'
  }
  if (code === 'GEMINI_NOT_PASS') {
    return 'Gemini hard gate 没有通过 · Fix the verdict, rerun the worker/validator, then check Draft PR again.'
  }
  if (code === 'DRAFT_PR_EXECUTOR_UNAVAILABLE') {
    return '没有配置 remote-write executor · No remote-write executor configured. Real Draft PRs need the worker-side executor + an authed GitHub token (P5).'
  }
  return 'Remote writes 默认关闭（安全门）· Remote writes are off by default (safety gate). Enabling allow_remote_writes for this repo (P5) lets the worker push a real Draft PR; until then "blocked" is the expected, safe outcome.'
}

const CLARIFY_GUIDANCE_FALLBACK = '还有几个问题需要你先确认，回答上面的待确认问题后就能继续 · Please answer the outstanding questions above; once answered, the AI can continue.'
const GENERIC_HUMAN_ERROR = '系统遇到问题，正在保护现场 · Something needs attention. The system paused safely; nothing was pushed or published.'

/**
 * v-ux-1 — north star: raw HTTP codes, gate codes and stack traces never reach
 * the primary chat flow. Structured CLARIFY-gate refusals become assistant-style
 * guidance; everything else becomes a generic human message with the raw text
 * tucked into an expandable detail.
 */
export function mapErrorToHuman(e: unknown): { kind: 'guidance' | 'error'; text: string; detail?: string } {
  const err = e instanceof Error ? e : new Error(String(e))
  const body = err instanceof ApiError
    ? err.body as { humanState?: string; guidance?: string; blocked?: { code?: string } } | null
    : null
  if (body && (body.humanState === 'needs_more_context' || body.blocked?.code === 'CLARIFY_GATE_BLOCKED')) {
    return { kind: 'guidance', text: body.guidance ?? CLARIFY_GUIDANCE_FALLBACK }
  }
  if (/CLARIFY_GATE_BLOCKED|HTTP 409|\b409\b/.test(err.message)) {
    return { kind: 'guidance', text: CLARIFY_GUIDANCE_FALLBACK }
  }
  if (/Load failed|Failed to fetch|NetworkError/i.test(err.message)) {
    return { kind: 'error', text: 'Load failed. Daemon connection is down or restarting. 请确认 pnpm cockpit:dev 仍在运行，然后刷新页面。' }
  }
  if (/HTTP 404: \/operator\//.test(err.message)) {
    return {
      kind: 'error',
      text: '控制台和后台版本不一致，请重启 pnpm cockpit:dev · The dashboard is newer than the daemon — restart with: pnpm cockpit:dev',
      detail: err.message,
    }
  }
  return { kind: 'error', text: GENERIC_HUMAN_ERROR, detail: err.message }
}

function isHoldResponse(out: unknown): out is { hold: { code: string; reason: string } } {
  return Boolean(
    out &&
    typeof out === 'object' &&
    'hold' in out &&
    (out as { hold?: { code?: unknown; reason?: unknown } }).hold &&
    typeof (out as { hold: { code?: unknown } }).hold.code === 'string' &&
    typeof (out as { hold: { reason?: unknown } }).hold.reason === 'string',
  )
}

function latestHoldMessage(messages: ApiOperatorMessage[]): string | null {
  const message = [...messages].reverse().find((m) => /^HOLD-[A-Z-]+:/m.test(m.content))
  if (!message) return null
  const [headline] = message.content.split('\n')
  const reason = message.content.match(/^Reason:\s*(.+)$/m)?.[1]
  return [headline, reason].filter(Boolean).join(' · ')
}

function actionName(label: string): string {
  return ({
    create: '创建会话并启动 brainstorm',
    message: '发送补充说明',
    ask: '请 AI 提出需要确认的问题',
    roadmap: '生成 PRD / ADR / Roadmap',
    approve: '批准路线图',
    start: '分配 worker agents 并执行',
    pause: '暂停 mission',
    resume: '恢复 mission',
    'draft-pr': '检查 draft PR gate',
  } as Record<string, string>)[label] ?? label
}

function actionStartMessage(label: string): string {
  return `正在处理 · ${actionName(label)}`
}

function actionDoneMessage(label: string): string {
  return ({
    create: '已创建对话。AI 正在后台 brainstorm；你可以继续补充约束。',
    ask: 'AI 正在准备需要你确认的问题，稍后自动出现在对话里。',
    roadmap: 'Plan 已生成：PRD/ADR/Roadmap 已写入。请预览方案，然后批准或补充说明。',
    approve: '路线图已批准。下一步可以启动执行。',
    start: '执行已启动。进度、验证和 PR 安全门会持续回到这条对话里。',
    'draft-pr': 'Draft PR gate 已检查。remote writes 关闭时，blocked 是安全预期；不会 push、创建 PR 或合并。',
  } as Record<string, string>)[label] ?? '操作完成。'
}

export function buildGuidance(opts: {
  session: ApiOperatorSession | null
  overview: ApiMissionOverview | null
  busy: string | null
  messages: ApiOperatorMessage[]
  latestHold: string | null
  sseConnected: boolean
  operatorView?: ApiOperatorMissionView
  onBrainstorm: () => void
  onRoadmap: () => void
  onApprove: () => void
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onDraftPr: () => void
  onReset: () => void
  onStop: () => void
}): Guidance {
  if (!opts.sseConnected) {
    return {
      kicker: 'Connection · 连接',
      title: 'Daemon event stream is disconnected · 事件流断开',
      body: '页面还可以尝试普通 API 请求，但实时状态可能不会更新。请确认 pnpm cockpit:dev 正在运行。',
    }
  }
  if (opts.busy) {
    return {
      kicker: 'Working · 正在执行',
      title: actionName(opts.busy),
      body: '动作已提交。长任务会在后台运行，状态、agent 和日志会自动刷新。',
    }
  }
  if (opts.session?.status === 'hold') {
    return {
      kicker: 'HOLD · 需要处理',
      title: 'Planner 没有成功启动 · Planner needs local CLI access',
      body: opts.latestHold ?? '请先修复本地 Claude/Codex CLI session，然后重新开始 brainstorm 或重试生成方案。',
      primary: { label: 'Retry Brainstorm · 重试讨论', onClick: opts.onBrainstorm, disabled: false },
      secondary: { label: 'Retry PRD · 重试方案', onClick: opts.onRoadmap, disabled: !opts.session },
    }
  }
  if (!opts.session) {
    return {
      kicker: 'Step 1 · 第一步',
      title: 'Start with a conversation · 先和 AI 讨论',
      // The "Start Brainstorm" button lives in the composer below (with the repo +
      // title + goal form), so the coach only guides — no duplicate CTA here.
      body: '在下方选择目标 repo、填写标题与目标，然后点击 Start Brainstorm。AI 会先讨论、提出需要确认的问题，而不是直接开工。',
    }
  }
  if (opts.session.status === 'brainstorming') {
    return {
      kicker: 'Brainstorm · 共创中',
      title: 'Planner is thinking · Planner 正在分析',
      body: '你会先看到占位消息；真实 brainstorm 完成后会自动出现在对话里。',
    }
  }
  if (!opts.session.missionId) {
    return {
      kicker: 'Decision · 做选择',
      title: 'Review the questions, then generate the plan · 先确认问题，再生成方案',
      body: '如果方向 OK，生成 PRD/ADR/Roadmap；如果不 OK，继续补充约束。',
      primary: { label: 'Generate Plan · 生成方案', onClick: opts.onRoadmap, disabled: false, testId: ACTION_TEST_IDS['generate-plan'] },
    }
  }
  if (opts.operatorView?.primaryAction) {
    const action = opts.operatorView.primaryAction
    const click = ({
      'generate-plan': opts.onRoadmap,
      'approve-roadmap': opts.onApprove,
      'start-execution': opts.onStart,
      'check-draft-pr-gate': opts.onDraftPr,
      resume: opts.onResume,
      pause: opts.onPause,
      'start-over': opts.onReset,
      'start-brainstorm': opts.onBrainstorm,
    } as Record<string, () => void>)[action.id]
    return {
      kicker: opts.operatorView.stageLabel,
      title: opts.operatorView.summary,
      body: `Next · 下一步: ${opts.operatorView.nextAction}`,
      primary: click ? { label: action.label, onClick: click, disabled: Boolean(action.disabled), testId: ACTION_TEST_IDS[action.id] } : undefined,
      secondary: opts.operatorView.secondaryActions[0] ? {
        label: opts.operatorView.secondaryActions[0].label,
        onClick: ({
          pause: opts.onPause,
          resume: opts.onResume,
          'start-over': opts.onStop,
        } as Record<string, () => void>)[opts.operatorView.secondaryActions[0].id] ?? opts.onReset,
        disabled: Boolean(opts.operatorView.secondaryActions[0].disabled),
        testId: ACTION_TEST_IDS[opts.operatorView.secondaryActions[0].id],
      } : undefined,
    }
  }
  // Drive the decision off the always-present session.status (roadmap_ready after
  // Generate, approved after Approve). overview.mission.status is fetched async and
  // may be null/failed/HOLD'd — gating on it dropped the inline Approve/Start to a
  // no-button "Monitor" default after Generate (redesign #2). overview stays a fallback.
  if (opts.session.status === 'roadmap_ready' || opts.overview?.mission.status === 'pending_approval') {
    return {
      kicker: 'Approval · 批准关口',
      title: 'Roadmap is waiting for you · 路线图等待确认',
      body: '预览 PRD/ADR/Roadmap 后，批准才会允许 worker 执行。批准本身不启动执行。',
      primary: { label: 'Approve Roadmap · 批准路线', onClick: opts.onApprove, disabled: false, testId: ACTION_TEST_IDS['approve-roadmap'] },
    }
  }
  if (opts.session.status === 'approved' || opts.overview?.mission.status === 'approved') {
    return {
      kicker: 'Ready · 可以执行',
      title: 'Agents are ready to run · Agents 已待命',
      body: '点击启动后会分配 coder worker，进度、证据和 validator 判词都会以内联卡片出现。',
      primary: { label: 'Start Execution · 启动执行', onClick: opts.onStart, disabled: false, testId: ACTION_TEST_IDS['start-execution'] },
    }
  }
  const missionStatus = opts.overview?.mission.status
  const latestRun = opts.overview?.runs?.[0]
  if (missionStatus === 'running' || opts.session?.status === 'running') {
    return {
      kicker: 'Running · 执行中',
      title: 'Worker is running · Worker 正在执行',
      body: 'coder worker 正在运行。模型“思考”时可能一段时间没有新日志，这是正常的，不代表卡住；这条对话会持续刷新进度。',
      primary: { label: 'Pause · 暂停', onClick: opts.onPause, disabled: false, testId: ACTION_TEST_IDS.pause },
      secondary: { label: 'Stop · 停止', onClick: opts.onStop, disabled: false, testId: ACTION_TEST_IDS['start-over'] },
    }
  }
  if (missionStatus === 'cancelled') {
    return {
      kicker: 'Cancelled · 已取消',
      title: 'Cancelled — background worker result ignored · 已取消',
      body: '已请求停止：mission 已标记 cancelled。正在运行的 worker 即使完成，其结果也会被丢弃，不会覆盖此状态。注意：当前层无法强杀子进程，detached worker 可能在后台继续运行到超时为止（hard-kill 属于 engine follow-up）。',
      primary: { label: 'Start Over · 重新开始', onClick: opts.onReset, disabled: false, testId: ACTION_TEST_IDS['start-over'] },
    }
  }
  if (missionStatus === 'failed') {
    const timedOut = latestRun?.exitCode === 124
    return {
      kicker: 'Failed · 执行失败',
      title: timedOut ? 'Worker timed out · Worker 超时' : 'Worker failed · Worker 执行失败',
      body: timedOut
        ? '本次 worker 超出时间预算被中止（exit 124）。任务越大越容易超时，可以把目标拆小后重试，或调大 AEDEV_COCKPIT_WORKER_TIMEOUT_MS。'
        : `本次 worker 失败${latestRun?.exitCode != null ? `（exit ${latestRun.exitCode}）` : ''}。对话里的过程和证据可用于判断原因，修复后可重新开始。`,
      primary: { label: 'Start Over · 重新开始', onClick: opts.onReset, disabled: false, testId: ACTION_TEST_IDS['start-over'] },
      secondary: { label: 'Check Draft PR Gate · 检查 PR 安全门', onClick: opts.onDraftPr, disabled: false, testId: ACTION_TEST_IDS['check-draft-pr-gate'] },
    }
  }
  // Reaching the evidence gate leaves the mission db-status 'paused' (enum limit)
  // but the session 'waiting' — that is NOT an operator pause, so show the gate.
  const atEvidenceGate = opts.session?.status === 'waiting'
  if (missionStatus === 'paused' && !atEvidenceGate) {
    return {
      kicker: 'Paused · 已暂停',
      title: 'Mission paused · 执行已暂停',
      body: '可以恢复执行，或基于当前证据创建草稿 PR（remote writes 关闭时会被安全拦截，这是预期行为）。',
      primary: { label: 'Resume · 恢复执行', onClick: opts.onResume, disabled: false, testId: ACTION_TEST_IDS.resume },
      secondary: { label: 'Check Draft PR Gate · 检查 PR 安全门', onClick: opts.onDraftPr, disabled: false, testId: ACTION_TEST_IDS['check-draft-pr-gate'] },
    }
  }
  if (missionStatus === 'done' || missionStatus === 'waiting' || atEvidenceGate) {
    const validatorsOff = opts.overview?.validatorStatus === 'not_configured'
    return {
      kicker: 'Done · 执行完成',
      title: 'Reached the evidence gate · 已到达证据闸',
      body: validatorsOff
        ? '执行完成，证据已写入。Gemini 未配置所以未运行；可以检查 Draft PR gate，当前 remote writes 关闭时会被安全门阻断。'
        : '执行完成，validator 结果和证据已回到对话里；确认无误后可以检查 Draft PR gate。',
      primary: { label: 'Check Draft PR Gate · 检查 PR 安全门', onClick: opts.onDraftPr, disabled: false, testId: ACTION_TEST_IDS['check-draft-pr-gate'] },
    }
  }
  return {
    kicker: 'Monitor · 监控',
    title: 'Watch the mission move · 查看执行进展',
    body: '继续在这条对话里观察进度、补充约束或推进下一步。',
  }
}

/**
 * v-ux-1 — compact read-only "Loop" card: what changed, what was checked, who
 * worked, what the reviewer said, and why the loop stopped or continues. All
 * content comes from the existing overview — no new endpoints.
 */
function LoopSummaryCard({ view }: { view?: ApiOperatorMissionView }) {
  const loop = view?.loopSummary
  if (!loop) return null
  return (
    <div className="ck-review-block" data-testid="cockpit-loop-summary">
      <div className="ck-review-head">
        <strong>Loop · 本轮工作</strong>
        <span>{view?.userState?.labelZh ?? 'read-only'}</span>
      </div>
      <div className="ck-review">
        <dl>
          <div><dt>Changed</dt><dd>{loop.whatChanged.length ? loop.whatChanged.join(', ') : '还没有文件改动 · No file changes yet'}</dd></div>
          <div><dt>Checks</dt><dd>{loop.testsRan.length ? loop.testsRan.join(', ') : '还没有检查记录 · No checks recorded yet'}</dd></div>
          <div><dt>Agents</dt><dd>{loop.agents.length ? loop.agents.join(', ') : '—'}</dd></div>
          <div><dt>Review</dt><dd>{loop.validatorSaid ?? '结果评审还没有结论 · No review verdict yet'}</dd></div>
          <div><dt>Why</dt><dd>{loop.whyStoppedOrContinuing}</dd></div>
        </dl>
      </div>
    </div>
  )
}

function IndependentReviewBlock({ overview }: { overview: ApiMissionOverview | null }) {
  const reviews = overview?.operatorView?.projectPulse.validatorReviews ?? []
  if (!reviews.length || !overview?.runs.length) return null
  return (
    <div className="ck-review-block" data-testid="cockpit-independent-review">
      <div className="ck-review-head">
        <strong>Independent Review · 独立验证</strong>
        <span>evidence-only</span>
      </div>
      {reviews.map((r) => (
        <div key={r.id} className={`ck-review ${r.verdict}`}>
          <div className="ck-review-verdict"><strong>{r.validator}</strong><span>{r.verdict}</span></div>
          <p>{r.summary}</p>
          <dl>
            <div><dt>Checked</dt><dd>{r.checkedEvidence.length ? r.checkedEvidence.join(', ') : 'No evidence files recorded yet'}</dd></div>
            <div><dt>Blocking</dt><dd>{r.blockingIssues.length ? r.blockingIssues.join('; ') : 'None reported'}</dd></div>
            <div><dt>Gaps</dt><dd>{r.evidenceGaps.length ? r.evidenceGaps.join('; ') : 'None reported'}</dd></div>
            <div><dt>Next</dt><dd>{r.recommendedNextAction}</dd></div>
          </dl>
        </div>
      ))}
    </div>
  )
}

/** Codex-style collapsed "Worked for…" process block (redesign §4). */
function ProcessBlock({ overview, busy }: { overview: ApiMissionOverview | null; busy: string | null }) {
  const rp = overview?.runProgress
  const steps = (overview?.events ?? []).slice(0, 8).map((e) => ({ id: e.id, ...friendlyEvent(e.type, e.payload) }))
  if (!rp && steps.length === 0 && !busy) return null
  const running = rp?.status === 'running' || busy === 'start' || busy === 'create' || busy === 'roadmap'
  const elapsed = fmtElapsed(rp?.elapsedMs)
  const summary = running ? (rp ? `Working… · ${elapsed}` : 'Working…') : `Worked for ${elapsed}`
  return (
    <details className="ck-process">
      <summary>
        <span className={`ck-process-dot${running ? ' live' : ''}`} />
        <span className="ck-process-summary">{summary}</span>
        <span className="ck-process-meta">{steps.length} step{steps.length === 1 ? '' : 's'}</span>
      </summary>
      <div className="ck-process-steps">
        {steps.length ? steps.map((s) => (
          <div className="ck-process-step" key={s.id}>
            <strong>{s.label}</strong>{s.detail ? <span>{s.detail}</span> : null}
          </div>
        )) : <div className="ck-role">No process events yet · 暂无过程事件</div>}
      </div>
    </details>
  )
}

const EVENT_LABELS: Record<string, string> = {
  'operator.session.created': '已创建会话 · Session created',
  'operator.role_started': 'Planner 开始分析 · Planner thinking',
  'operator.role_done': 'Planner 完成 brainstorm · Planner done',
  'operator.roadmap_generation_started': '开始生成方案 · Generating PRD/ADR/Roadmap',
  'operator.roadmap_generation_done': '方案已生成 · Roadmap generated',
  'operator.artifact_written': '已写入文档 · Artifacts written',
  'operator.approval_recorded': '路线图已批准 · Roadmap approved',
  'operator.worker_assigned': '已分配 worker · Worker assigned',
  'operator.worker_started': 'Worker 启动 · Worker started',
  'operator.worker_log': 'Worker 日志 · Worker log',
  'operator.task_progress': '任务进度 · Task progress',
  'operator.evidence_written': '已写入 evidence · Evidence written',
  'operator.validator_started': '验证开始 · Validators started',
  'operator.validator_result': '验证结果 · Validator result',
  'operator.validator_done': '验证完成 · Validators done',
  'operator.validators_not_configured': '验证器未配置 · Validators not configured',
  'operator.draft_pr_created': 'Draft PR 已创建 · Draft PR created',
  'operator.draft_pr_blocked': 'Draft PR 被安全门拦截 · Draft PR blocked (safety gate)',
  'operator.hold_created': 'HOLD 待处理 · Hold needs you',
  'operator.worker_failed': 'Worker 失败 · Worker failed',
  'operator.cost_updated': 'Token 用量更新 · Token usage updated',
  'operator.stage_changed': '阶段更新 · Stage changed',
  'operator.message.added': '新增消息 · Message added',
  'mission.created': '任务已创建 · Mission created',
  'mission.route_selected': '已选择执行路线 · Route selected',
  'mission.run_started': '执行开始 · Run started',
  'mission.run_completed': '执行完成 · Run completed',
  'mission.run_failed': '执行失败 · Run failed',
  'mission.run_held': '执行已暂停 · Run held',
  'mission.status_changed': '状态更新 · Status changed',
}

function friendlyEvent(type: string, payload: Record<string, unknown>): { label: string; detail: string } {
  return { label: EVENT_LABELS[type] ?? type.replace(/^operator\./, ''), detail: eventDetail(type, payload ?? {}) }
}

function eventDetail(type: string, p: Record<string, unknown>): string {
  switch (type) {
    case 'operator.stage_changed': return p['stage'] ? `→ ${String(p['stage'])}` : ''
    case 'operator.worker_assigned': return `${String(p['mode'] ?? '')}${p['availableSessions'] !== undefined ? ` · ${String(p['availableSessions'])} sessions` : ''}`
    case 'operator.worker_started': return String(p['provider'] ?? '')
    case 'operator.validator_result': return `${String(p['validator'] ?? '')}: ${String(p['verdict'] ?? '')}`
    case 'operator.validator_done': return Array.isArray(p['verdicts']) ? (p['verdicts'] as unknown[]).join(', ') : ''
    case 'operator.draft_pr_blocked': return String(p['code'] ?? '')
    case 'operator.hold_created': return String(p['holdCode'] ?? '')
    default: return ''
  }
}
