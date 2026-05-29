import { useEffect, useMemo, useRef, useState } from 'react'
import {
  api,
  type ApiMission,
  type ApiMissionOverview,
  type ApiOperatorChoice,
  type ApiOperatorMessage,
  type ApiOperatorSession,
  type ApiRepo,
} from '../api.js'
import { useSSE } from '../hooks/useSSE.js'

const DEFAULT_PROMPT = 'Brainstorm a low-risk improvement, produce PRD/ADR/roadmap, then execute to the draft PR/evidence gate.'
const SESSION_STORAGE_KEY = 'operatorCockpitSessionId'
const STAGE_LABELS: Record<string, string> = {
  Intake: '输入 Intake',
  Brainstorm: '共创 Brainstorm',
  PRD: '方案 PRD',
  ADR: '架构 ADR',
  Roadmap: '路线 Roadmap',
  Approved: '批准 Approved',
  Worker: '执行 Worker',
  Tests: '测试 Tests',
  Validators: '验证 Validators',
  'PR/Waiting/Blocked': '交付 Gate',
}
type GuidanceAction = { label: string; onClick: () => void; disabled: boolean }
interface Guidance {
  kicker: string
  title: string
  body: string
  primary?: GuidanceAction
  secondary?: GuidanceAction
}

export function CockpitPage() {
  const sse = useSSE('/api/events/stream')
  const [repos, setRepos] = useState<ApiRepo[]>([])
  const [repoId, setRepoId] = useState('')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [title, setTitle] = useState('Operator Cockpit Mission')
  const [session, setSession] = useState<ApiOperatorSession | null>(null)
  const [messages, setMessages] = useState<ApiOperatorMessage[]>([])
  const [overview, setOverview] = useState<ApiMissionOverview | null>(null)
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [runLog, setRunLog] = useState('')
  const [draftPrStatus, setDraftPrStatus] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const promptRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    api.getRepos().then((r) => {
      setRepos(r)
      setRepoId((current) => current || r[0]?.id || 'unknown')
    }).catch((e: Error) => setErr(e.message))
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

  useEffect(() => {
    const latestRun = overview?.runs?.[0]
    if (!overview?.mission.id || !latestRun) {
      setRunLog('')
      return
    }
    const load = () => api.getRunLog(overview.mission.id, latestRun.id).then((x) => setRunLog(x.text)).catch(() => undefined)
    void load()
    const timer = setInterval(load, latestRun.status === 'running' ? 1_000 : 5_000)
    return () => clearInterval(timer)
  }, [overview?.mission.id, overview?.runs?.[0]?.id, overview?.runs?.[0]?.status])

  const latestEvents = useMemo(() => sse.events.slice(0, 12), [sse.events])

  async function action<T>(label: string, fn: () => Promise<T>, after?: (x: T) => void) {
    setBusy(label)
    setErr(null)
    setNotice(actionStartMessage(label))
    try {
      const out = await fn()
      after?.(out)
      setNotice(actionDoneMessage(label))
    } catch (e) {
      setErr(formatError(e as Error))
      setNotice(null)
    } finally {
      setBusy(null)
    }
  }

  function resetMission() {
    localStorage.removeItem(SESSION_STORAGE_KEY)
    setSession(null)
    setMessages([])
    setOverview(null)
    setSelectedArtifactId(null)
    setRunLog('')
    setDraftPrStatus(null)
    setErr(null)
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
      promptRef.current?.focus()
      setNotice('请在左侧输入框补充你的约束，然后点击 Add Note · Type your constraints on the left, then Add Note.')
    }
  }

  const guidance = buildGuidance({
    session,
    overview,
    busy,
    messages,
    sseConnected: sse.connected,
    onBrainstorm: () => action('create', () => api.createOperatorSession({ repoId, title, prompt }), (x) => { setSession(x.session); setMessages(x.messages); setOverview(null); setDraftPrStatus(null) }),
    onRoadmap: () => session && action('roadmap', () => api.generateRoadmap(session.id), (x) => { setSession(x.session); setMessages(x.messages); if (x.mission) void api.getMissionOverview(x.mission.id).then(setOverview) }),
    onApprove: () => session && action('approve', () => api.approveRoadmap(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onStart: () => session && action('start', () => api.startOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
  })

  return (
    <div className="cockpit">
      <header className="cockpit-top">
        <div>
          <p className="eyebrow">Claude Code 24/7</p>
          <h1>Operator Cockpit · AI 共创工作台</h1>
          <p>像和一个 coding coworker 协作：先讨论，再确认方案，然后看着 agents 执行到 evidence gate。</p>
        </div>
        <div className="health-strip">
          <span className={`dot${sse.connected ? '' : ' off'}`} /> daemon
          <strong>{sse.pendingApprovals}</strong> approvals
          <strong>{overview?.cost.runCount ?? 0}</strong> runs
          <strong>{overview?.cost.costUsd ?? 'unknown'}</strong> cost
        </div>
      </header>

      {err && <div className="error">Error: {err}</div>}
      <section className={`coach-card ${sse.connected ? '' : 'warn'}`}>
        <div>
          <span>{guidance.kicker}</span>
          <strong>{guidance.title}</strong>
          <p>{guidance.body}</p>
        </div>
        <div className="coach-actions">
          {guidance.primary && <button className="action primary" disabled={guidance.primary.disabled || Boolean(busy)} onClick={guidance.primary.onClick}>{guidance.primary.label}</button>}
          {guidance.secondary && <button className="action secondary" disabled={guidance.secondary.disabled || Boolean(busy)} onClick={guidance.secondary.onClick}>{guidance.secondary.label}</button>}
        </div>
      </section>
      {notice && <div className="notice">{notice}</div>}

      <section className="cockpit-grid">
        <div className="panel conversation">
          <div className="panel-title">Conversation · 对话</div>
          <label>Repo · 仓库</label>
          <select value={repoId} onChange={(e) => setRepoId(e.target.value)}>
            {repos.length === 0 && <option value="unknown">unknown</option>}
            {repos.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <label>Title · 标题</label>
          <input value={title} onChange={(e) => setTitle(e.target.value)} />
          <label>Brainstorm prompt · 你的想法</label>
          <textarea ref={promptRef} value={prompt} onChange={(e) => setPrompt(e.target.value)} />
          <div className="button-row">
            <button className="action" disabled={Boolean(busy)} onClick={() => action('create', () => api.createOperatorSession({ repoId, title, prompt }), (x) => { setSession(x.session); setMessages(x.messages); setOverview(null); setDraftPrStatus(null) })}>
              New Brainstorm · 开始讨论
            </button>
            <button className="action" disabled={!session || Boolean(busy)} onClick={() => action('message', () => api.addOperatorMessage(session!.id, prompt), (x) => setMessages(x.messages))}>
              Add Note · 补充说明
            </button>
            <button className="action secondary" disabled={!session || Boolean(busy)} onClick={resetMission}>
              New Mission · 新任务
            </button>
          </div>
          <ChoiceBar session={session} messages={messages} busy={busy} onChoice={handleChoice} />
          <div className="message-list">
            {messages.length === 0 ? <div className="empty">No conversation yet.</div> : messages.map((m) => (
              <div key={m.id} className={`message ${m.role}`}>
                <span>{m.role}</span>
                <p>{m.content}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="panel execution">
          <div className="panel-title">Roadmap & Execution · 方案与执行</div>
          <Timeline overview={overview} mission={session?.missionId ? overview?.mission : undefined} />
          <div className="button-row">
            <button className="action" disabled={!session || Boolean(busy)} onClick={() => action('roadmap', () => api.generateRoadmap(session!.id), (x) => { setSession(x.session); setMessages(x.messages); if (x.mission) void api.getMissionOverview(x.mission.id).then(setOverview) })}>
              Generate PRD · 生成方案
            </button>
            <button className="action primary" disabled={!session?.missionId || overview?.mission.status === 'approved' || Boolean(busy)} onClick={() => action('approve', () => api.approveRoadmap(session!.id), (x) => { setSession(x.session); setOverview(x.overview) })}>
              Approve · 批准路线
            </button>
            <button className={`action${overview?.mission.status === 'approved' ? ' primary pulse' : ''}`} disabled={!session?.missionId || overview?.mission.status !== 'approved' || Boolean(busy)} onClick={() => action('start', () => api.startOperatorSession(session!.id), (x) => { setSession(x.session); setOverview(x.overview) })}>
              Start · 启动执行
            </button>
            <button className="action" disabled={!session?.missionId || Boolean(busy)} onClick={() => action('pause', () => api.pauseOperatorSession(session!.id), (x) => { setSession(x.session); setOverview(x.overview) })}>
              Pause · 暂停
            </button>
            <button className="action" disabled={!session?.missionId || Boolean(busy)} onClick={() => action('resume', () => api.resumeOperatorSession(session!.id), (x) => { setSession(x.session); setOverview(x.overview) })}>
              Resume · 恢复
            </button>
            <button className="action" disabled={!session?.missionId || Boolean(busy)} onClick={() => action('draft-pr', () => api.createDraftPr(session!.id), (x) => { setOverview(x.overview); setDraftPrStatus(x.pr?.url ?? `${x.code ?? x.status}: ${x.reason ?? ''}`) })}>
              Draft PR · 创建草稿
            </button>
          </div>
          {busy && <div className="running">Working now · 正在处理：{actionName(busy)}</div>}
          {draftPrStatus && <div className="running">Draft PR: {draftPrStatus}</div>}
          <AgentActivity overview={overview} session={session} busy={busy} />
          <MissionSnapshot overview={overview} />
          <ApprovalCard overview={overview} />
          <DocumentPreview overview={overview} selectedId={selectedArtifactId} onSelect={setSelectedArtifactId} />
        </div>

        <div className="panel observability">
          <div className="panel-title">Observability · 运行状态</div>
          <RunPanel overview={overview} />
          <ExecutionMonitor overview={overview} runLog={runLog} />
          <ArtifactList overview={overview} selectedId={selectedArtifactId} onSelect={setSelectedArtifactId} />
          <EventLog events={latestEvents} />
        </div>
      </section>
    </div>
  )
}

function formatError(e: Error): string {
  if (/Load failed|Failed to fetch|NetworkError/i.test(e.message)) {
    return 'Load failed. Daemon connection is down or restarting. 请确认 pnpm cockpit:dev 仍在运行，然后刷新页面。'
  }
  if (/HTTP 404: \/operator\//.test(e.message)) {
    return `${e.message}. The dashboard is newer than the daemon on port 7247. Restart with: pnpm cockpit:dev`
  }
  return e.message
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
    ask: 'AI 正在准备需要你确认的问题，稍后自动出现在左侧对话。',
    roadmap: 'PRD/ADR/Roadmap 已生成。请预览方案，然后批准或补充说明。',
    approve: '路线图已批准。下一步可以启动执行。',
    start: '执行已启动。右侧会显示 agent、run、log 和 evidence。',
    'draft-pr': 'Draft PR gate 已检查。默认 remote writes 关闭，所以 blocked 是安全预期。',
  } as Record<string, string>)[label] ?? '操作完成。'
}

function buildGuidance(opts: {
  session: ApiOperatorSession | null
  overview: ApiMissionOverview | null
  busy: string | null
  messages: ApiOperatorMessage[]
  sseConnected: boolean
  onBrainstorm: () => void
  onRoadmap: () => void
  onApprove: () => void
  onStart: () => void
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
  if (!opts.session) {
    return {
      kicker: 'Step 1 · 第一步',
      title: 'Start with a conversation · 先和 AI 讨论',
      body: '输入你的目标，AI 会先 brainstorm、提出需要确认的问题，而不是直接开工。',
      primary: { label: 'Start Brainstorm · 开始讨论', onClick: opts.onBrainstorm, disabled: false },
    }
  }
  if (opts.session.status === 'brainstorming') {
    return {
      kicker: 'Brainstorm · 共创中',
      title: 'Planner is thinking · Planner 正在分析',
      body: '你会先看到占位消息；真实 brainstorm 完成后会自动出现在左侧对话里。',
    }
  }
  if (!opts.session.missionId) {
    return {
      kicker: 'Decision · 做选择',
      title: 'Review the questions, then generate the plan · 先确认问题，再生成方案',
      body: '如果方向 OK，生成 PRD/ADR/Roadmap；如果不 OK，继续补充约束。',
      primary: { label: 'Generate PRD · 生成方案', onClick: opts.onRoadmap, disabled: false },
    }
  }
  if (opts.overview?.mission.status === 'pending_approval') {
    return {
      kicker: 'Approval · 批准关口',
      title: 'Roadmap is waiting for you · 路线图等待确认',
      body: '预览 PRD/ADR/Roadmap 后，批准才会允许 worker 执行。批准本身不启动执行。',
      primary: { label: 'Approve · 批准路线', onClick: opts.onApprove, disabled: false },
    }
  }
  if (opts.overview?.mission.status === 'approved') {
    return {
      kicker: 'Ready · 可以执行',
      title: 'Agents are ready to run · Agents 已待命',
      body: '点击启动后会分配 coder worker，右侧显示 run、日志、tokens、evidence 和 validators。',
      primary: { label: 'Start Execution · 启动执行', onClick: opts.onStart, disabled: false },
    }
  }
  return {
    kicker: 'Monitor · 监控',
    title: 'Watch the mission move · 查看执行进展',
    body: '右侧是运行状态，中央是方案与审批，左侧可以继续补充上下文。',
  }
}

function ChoiceBar({ session, messages, busy, onChoice }: {
  session: ApiOperatorSession | null
  messages: ApiOperatorMessage[]
  busy: string | null
  onChoice: (choice: ApiOperatorChoice) => void
}) {
  if (!session || session.missionId) return null
  const choices = [...messages].reverse().find((m) => m.choices && m.choices.length)?.choices
  if (!choices || !choices.length) return null
  return (
    <div className="choice-bar">
      <span>Next choice · 下一步选择</span>
      <div className="choice-row">
        {choices.map((c) => (
          <button key={c.id} disabled={Boolean(busy)} onClick={() => onChoice(c)}>
            <strong>{c.label}</strong>
            <em>{c.labelEn}</em>
          </button>
        ))}
      </div>
    </div>
  )
}

function AgentActivity({ overview, session, busy }: {
  overview: ApiMissionOverview | null
  session: ApiOperatorSession | null
  busy: string | null
}) {
  const agents = [
    { id: 'planner', label: 'Planner · 规划', active: busy === 'create' || busy === 'roadmap' || session?.status === 'brainstorming' },
    { id: 'architect', label: 'Architect · 架构', active: overview?.stage === 'ADR' || overview?.stage === 'Roadmap' },
    { id: 'coder', label: 'Coder · 执行', active: overview?.stage === 'Worker' || overview?.runs.some((r) => r.status === 'running') },
    { id: 'validator', label: 'Validator · 验证', active: overview?.stage === 'Validators' },
  ]
  const rows = (overview?.events ?? []).map((e) => ({ id: e.id, ...friendlyEvent(e.type, e.payload) })).slice(0, 6)
  return (
    <div className="agent-activity">
      <div className="subhead">Agent Activity · Agent 动作</div>
      <div className="agent-grid">
        {agents.map((agent) => (
          <div key={agent.id} className={`agent-pill ${agent.active ? 'active' : ''}`}>
            <strong>{agent.label}</strong>
            <span>{agent.active ? 'Working' : 'Ready'}</span>
          </div>
        ))}
      </div>
      <div className="activity-feed">
        {rows.length ? rows.map((r) => (
          <div className="activity-row" key={r.id}>
            <strong>{r.label}</strong>
            {r.detail && <span>{r.detail}</span>}
          </div>
        )) : <p>No agent events yet · 暂无 agent 事件</p>}
      </div>
    </div>
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

function Timeline({ overview, mission }: { overview: ApiMissionOverview | null; mission?: ApiMission }) {
  const stages = overview?.stages ?? ['Intake', 'Brainstorm', 'PRD', 'ADR', 'Roadmap', 'Approved', 'Worker', 'Tests', 'Validators', 'PR/Waiting/Blocked'].map((stage, i) => ({ stage, status: i === 0 ? 'active' : 'pending' }))
  return (
    <div className="timeline">
      {stages.map((s) => <div key={s.stage} className={`stage ${s.status}`}>{s.stage}</div>)}
      <div className="progress"><span style={{ width: `${Math.round((overview?.progress ?? 0.08) * 100)}%` }} /></div>
      <div className="mission-meta">{mission ? `${mission.title} · ${mission.status}` : 'No mission generated yet'}</div>
    </div>
  )
}

function MissionSnapshot({ overview }: { overview: ApiMissionOverview | null }) {
  if (!overview) return <div className="empty">Generate a PRD to see mission detail.</div>
  return (
    <div className="snapshot">
      <div><span>Stage</span><strong>{overview.stage}</strong></div>
      <div><span>CLI</span><strong>{overview.cliProvider}</strong></div>
      <div><span>Agents</span><strong>{overview.activeAgents.join(', ')}</strong></div>
      <div><span>Holds</span><strong>{overview.holds.length}</strong></div>
    </div>
  )
}

function RunPanel({ overview }: { overview: ApiMissionOverview | null }) {
  return (
    <div className="run-panel">
      <div className="subhead">Tokens & Cost</div>
      <p>{overview?.cost.note ?? 'Usage appears here when provider data is available.'}</p>
      <div className="metric-row"><span>Input</span><strong>{overview?.cost.inputTokens ?? 'unknown'}</strong></div>
      <div className="metric-row"><span>Output</span><strong>{overview?.cost.outputTokens ?? 'unknown'}</strong></div>
      <div className="metric-row"><span>Total tokens</span><strong>{overview?.cost.totalTokens ?? 'unknown'}</strong></div>
      <div className="metric-row"><span>Scope</span><strong>{overview?.cost.scope ?? 'unknown'}</strong></div>
      <div className="metric-row"><span>Cost</span><strong>{overview?.cost.costUsd ?? 'unknown'}</strong></div>
      <div className="subhead">Validators</div>
      {overview?.validators.length ? overview.validators.map((v) => (
        <div key={v.id} className={`validator ${v.verdict}`}>
          <strong>{v.validator}: {v.verdict}</strong>
          <p>{v.summary || 'No summary'}</p>
        </div>
      )) : <div className="empty">{overview?.validatorStatus === 'not_configured' ? (overview.validatorNote ?? 'Validators are not configured.') : 'No validator results yet.'}</div>}
    </div>
  )
}

function ApprovalCard({ overview }: { overview: ApiMissionOverview | null }) {
  if (!overview) return null
  const approval = overview.approvals?.[0]
  return (
    <div className="approval-card">
      <div className="subhead">Approval Gate</div>
      <div className="metric-row"><span>Status</span><strong>{approval?.status ?? (overview.mission.status === 'approved' ? 'approved' : 'not requested')}</strong></div>
      <div className="metric-row"><span>Reason</span><strong>{approval?.requiredReason ?? 'Roadmap approval required before execution'}</strong></div>
    </div>
  )
}

function DocumentPreview({ overview, selectedId, onSelect }: { overview: ApiMissionOverview | null; selectedId: string | null; onSelect: (id: string) => void }) {
  const previewable = overview?.artifacts.filter((a) => a.preview) ?? []
  const selected = previewable.find((a) => a.id === selectedId) ?? previewable.find((a) => a.type === 'prd') ?? previewable[0]
  if (!selected) return <div className="doc-preview empty">Generate PRD to preview concrete PRD/ADR/roadmap content here.</div>
  return (
    <div className="doc-preview">
      <div className="subhead">Plan Preview</div>
      <div className="preview-tabs">
        {previewable.map((a) => (
          <button key={a.id} className={selected.id === a.id ? 'active' : ''} onClick={() => onSelect(a.id)}>
            {a.title ?? a.type}
          </button>
        ))}
      </div>
      <pre>{selected.preview}</pre>
    </div>
  )
}

function ExecutionMonitor({ overview, runLog }: { overview: ApiMissionOverview | null; runLog: string }) {
  return (
    <div className="execution-monitor">
      <div className="subhead">Execution Monitor</div>
      {overview ? (
        <>
          <div className="metric-row"><span>Tasks</span><strong>{overview.tasks.map((t) => `${t.title}: ${t.status}`).join(' | ') || 'none'}</strong></div>
          <div className="metric-row"><span>Runs</span><strong>{overview.runs.map((r) => `${r.runnerMode}: ${r.status}${r.exitCode !== undefined ? ` (${r.exitCode})` : ''}`).join(' | ') || 'none'}</strong></div>
          <div className="metric-row"><span>Evidence</span><strong>{overview.evidenceDir ?? 'pending'}</strong></div>
          <pre className="worker-log">{runLog || 'Waiting for worker log.'}</pre>
        </>
      ) : <div className="empty">No worker activity yet.</div>}
    </div>
  )
}

function ArtifactList({ overview, selectedId, onSelect }: { overview: ApiMissionOverview | null; selectedId: string | null; onSelect: (id: string) => void }) {
  return (
    <div>
      <div className="subhead">Artifacts</div>
      {overview?.artifacts.length ? overview.artifacts.map((a) => (
        <button className={`artifact${selectedId === a.id ? ' active' : ''}`} key={a.id} onClick={() => onSelect(a.id)}>
          <span>{a.type}</span>
          <strong>{a.title ?? a.type}</strong>
          <code>{a.path}</code>
        </button>
      )) : <div className="empty">No PRD/ADR/evidence paths yet.</div>}
    </div>
  )
}

function EventLog({ events }: { events: Array<{ id: string; kind: string; payload: unknown }> }) {
  return (
    <details className="raw-events">
      <summary>Raw event stream · 原始事件（开发者）</summary>
      {events.length === 0 ? <div className="empty">Waiting for events.</div> : events.map((e) => (
        <div className="event" key={e.id}>
          <strong>{e.kind}</strong>
          <code>{JSON.stringify(e.payload).slice(0, 120)}</code>
        </div>
      ))}
    </details>
  )
}
