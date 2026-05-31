import { useEffect, useMemo, useState } from 'react'
import {
  api,
  type ApiMissionOverview,
  type ApiOperatorChoice,
  type ApiOperatorMessage,
  type ApiOperatorSession,
  type ApiRepo,
} from '../api.js'
import { useSSE } from '../hooks/useSSE.js'
import { Sidebar } from './cockpit/Sidebar.js'
import { ChatThread } from './cockpit/ChatThread.js'
import { Composer } from './cockpit/Composer.js'
import { ExecutionTimeline } from './cockpit/ExecutionTimeline.js'
import { CommandPalette, type Command } from './cockpit/CommandPalette.js'
import './cockpit/cockpit.css'

const DEFAULT_PROMPT = 'Brainstorm a low-risk improvement, produce PRD/ADR/roadmap, then execute to the draft PR/evidence gate.'
const SESSION_STORAGE_KEY = 'operatorCockpitSessionId'
const PANELS_STORAGE_KEY = 'operatorCockpitPanels'
const TAB_STORAGE_KEY = 'operatorCockpitInspectorTab'

type InspectorTab = 'roadmap' | 'activity' | 'diff' | 'monitor' | 'approvals'
const INSPECTOR_TABS: { id: InspectorTab; label: string }[] = [
  { id: 'roadmap', label: 'Roadmap' },
  { id: 'activity', label: 'Activity' },
  { id: 'diff', label: 'Diff & PR' },
  { id: 'monitor', label: 'Monitor' },
  { id: 'approvals', label: 'Approvals' },
]

function loadPanelState(): { sidebar: boolean; inspector: boolean } {
  try {
    const raw = localStorage.getItem(PANELS_STORAGE_KEY)
    if (raw) return { sidebar: true, inspector: true, ...JSON.parse(raw) }
  } catch { /* ignore */ }
  return { sidebar: true, inspector: true }
}

function loadInspectorTab(): InspectorTab {
  try {
    const raw = localStorage.getItem(TAB_STORAGE_KEY)
    if (raw && INSPECTOR_TABS.some((t) => t.id === raw)) return raw as InspectorTab
  } catch { /* ignore */ }
  return 'roadmap'
}

function fmtElapsed(ms: number | null | undefined): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
type GuidanceAction = { label: string; onClick: () => void; disabled: boolean }
interface Guidance {
  kicker: string
  title: string
  body: string
  primary?: GuidanceAction
  secondary?: GuidanceAction
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
  const [selectedArtifactId, setSelectedArtifactId] = useState<string | null>(null)
  const [runLog, setRunLog] = useState('')
  const [draftPrStatus, setDraftPrStatus] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [sessions, setSessions] = useState<ApiOperatorSession[]>([])
  const [note, setNote] = useState('')
  const [panels, setPanels] = useState(loadPanelState)
  const [tab, setTab] = useState<InspectorTab>(loadInspectorTab)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const togglePanel = (key: 'sidebar' | 'inspector') => setPanels((p) => {
    const next = { ...p, [key]: !p[key] }
    try { localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(next)) } catch { /* ignore */ }
    return next
  })
  // Switch the inspector to a tab, opening it if it was hidden (single dock at a time).
  const selectTab = (next: InspectorTab) => {
    setTab(next)
    try { localStorage.setItem(TAB_STORAGE_KEY, next) } catch { /* ignore */ }
    setPanels((p) => {
      if (p.inspector) return p
      const merged = { ...p, inspector: true }
      try { localStorage.setItem(PANELS_STORAGE_KEY, JSON.stringify(merged)) } catch { /* ignore */ }
      return merged
    })
  }

  useEffect(() => {
    api.getRepos().then((r) => {
      setRepos(r)
      setRepoId((current) => current || r[0]?.id || 'unknown')
    }).catch((e: Error) => setErr(e.message))
  }, [])

  useEffect(() => {
    const load = () => api.listOperatorSessions().then(setSessions).catch(() => undefined)
    void load()
    const timer = setInterval(load, 4_000)
    return () => clearInterval(timer)
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

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'k' || e.key === 'K')) {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const latestEvents = useMemo(() => sse.events.slice(0, 12), [sse.events])
  const latestHold = useMemo(() => latestHoldMessage(messages), [messages])

  async function action<T>(label: string, fn: () => Promise<T>, after?: (x: T) => void) {
    setBusy(label)
    setErr(null)
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
      setErr(formatError(e as Error))
      setNotice(null)
    } finally {
      setBusy(null)
    }
  }

  function loadSession(id: string) {
    if (id === session?.id) return
    setOverview(null); setRunLog(''); setDraftPrStatus(null); setErr(null); setNote('')
    api.getOperatorSession(id).then((x) => {
      setSession(x.session)
      setMessages(x.messages)
      setTitle(x.session.title)
      setPrompt(x.session.prompt)
      if (x.session.repoId) setRepoId(x.session.repoId)
      localStorage.setItem(SESSION_STORAGE_KEY, x.session.id)
      if (x.session.missionId) void api.getMissionOverview(x.session.missionId).then(setOverview)
    }).catch((e: Error) => setErr(e.message))
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
    onBrainstorm: () => action('create', () => api.createOperatorSession({ repoId, title, prompt }), (x) => { setSession(x.session); setMessages(x.messages); setOverview(null); setDraftPrStatus(null) }),
    onRoadmap: () => session && action('roadmap', () => api.generateRoadmap(session.id), (x) => { setSession(x.session); setMessages(x.messages); if (x.mission) void api.getMissionOverview(x.mission.id).then(setOverview) }),
    onApprove: () => session && action('approve', () => api.approveRoadmap(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onStart: () => session && action('start', () => api.startOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onPause: () => session && action('pause', () => api.pauseOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onResume: () => session && action('resume', () => api.resumeOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }),
    onDraftPr: () => session && action('draft-pr', () => api.createDraftPr(session.id), (x) => { setOverview(x.overview); setDraftPrStatus(x.pr?.url ?? `${x.code ?? x.status}: ${x.reason ?? ''}`) }),
    onReset: resetMission,
  })

  const hasSession = Boolean(session)
  const canGenerate = Boolean(session) && !session?.missionId
  const pendingCount = Math.max(pendingApprovals, sse.pendingApprovals)
  const selectedRepoName = repos.find((r) => r.id === repoId)?.name ?? (repoId || '—')

  const commands: Command[] = []
  commands.push({ id: 'new', title: 'New mission · 新任务', hint: 'reset', run: resetMission })
  commands.push({ id: 'toggle-sidebar', title: panels.sidebar ? 'Collapse history sidebar' : 'Expand history sidebar', hint: 'layout', run: () => togglePanel('sidebar') })
  commands.push({ id: 'toggle-inspector', title: panels.inspector ? 'Hide inspector' : 'Show inspector', hint: 'layout', run: () => togglePanel('inspector') })
  for (const t of INSPECTOR_TABS) commands.push({ id: `tab-${t.id}`, title: `Go to ${t.label}`, hint: 'inspector', run: () => selectTab(t.id) })
  const missionStatusForCmd = overview?.mission.status
  if (session?.missionId && missionStatusForCmd !== 'approved') {
    commands.push({ id: 'approve', title: 'Approve roadmap · 批准', hint: 'action', run: () => action('approve', () => api.approveRoadmap(session.id), (x) => { setSession(x.session); setOverview(x.overview) }) })
  }
  if (session?.missionId && missionStatusForCmd === 'approved') {
    commands.push({ id: 'start', title: 'Start execution · 启动', hint: 'action', run: () => action('start', () => api.startOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }) })
  }
  if (session?.missionId) {
    commands.push({ id: 'pause', title: 'Pause mission · 暂停', hint: 'action', run: () => action('pause', () => api.pauseOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }) })
    commands.push({ id: 'resume', title: 'Resume mission · 恢复', hint: 'action', run: () => action('resume', () => api.resumeOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) }) })
    commands.push({ id: 'draft-pr', title: 'Draft PR · 创建草稿', hint: 'action', run: () => action('draft-pr', () => api.createDraftPr(session.id), (x) => { setOverview(x.overview); setDraftPrStatus(x.pr?.url ?? `${x.code ?? x.status}: ${x.reason ?? ''}`) }) })
  }
  commands.push({ id: 'open-approvals', title: 'Open approvals page · 审批', hint: 'navigate', run: () => onNavigate?.('approvals') })

  return (
    <div className="cockpit">
      <header className="ck-topstrip">
        <span className="ck-brand"><span className={`dot${sse.connected ? '' : ' off'}`} />aedev · cockpit</span>
        <span className="ck-stat"><span className="k">provider</span><span className="v">{overview?.cliProvider ?? '—'}</span></span>
        <span className="ck-stat"><span className="k">runs</span><span className="v">{overview?.cost.runCount ?? 0}</span></span>
        <span className="ck-stat"><span className="k">tokens</span><span className="v">{overview?.cost.totalTokens ?? '—'}</span></span>
        <span className="ck-stat"><span className="k">cost</span><span className="v">{overview?.cost.costUsd ?? 'unknown'}</span></span>
        <span className="ck-strip-spacer" />
        <span className="ck-stat"><span className="k">repo</span><span className="v">{selectedRepoName}</span></span>
        <button className="ck-stat approvals" onClick={() => onNavigate?.('approvals')} title="Open approvals · 打开审批">
          <span className="k">approvals</span><span className="v">{pendingCount}</span>
        </button>
        <button className="ck-kbd" title="Command palette (⌘K)" onClick={() => setPaletteOpen(true)}>⌘K</button>
      </header>

      <div className={`cockpit-shell${panels.sidebar ? '' : ' rail'}${panels.inspector ? '' : ' no-inspector'}`}>
        <Sidebar
          sessions={sessions}
          repos={repos}
          activeId={session?.id ?? null}
          collapsed={!panels.sidebar}
          onSelect={loadSession}
          onNew={resetMission}
          onToggle={() => togglePanel('sidebar')}
        />

        <div className="ck-main">
          <div className="ck-topbar">
            <button className={`ck-toggle${panels.sidebar ? ' on' : ''}`} onClick={() => togglePanel('sidebar')} title="Toggle history · 历史">☰</button>
            <div className="ck-coach">
              <div className="ck-coach-kicker">{guidance.kicker}</div>
              <div className="ck-coach-title">{guidance.title}</div>
              <div className="ck-coach-body">{guidance.body}</div>
            </div>
            <div className="ck-toggles">
              <button className={`ck-toggle${panels.inspector ? ' on' : ''}`} onClick={() => togglePanel('inspector')} title="Toggle inspector · 检查器">Inspector</button>
              <button className="ck-toggle" onClick={() => setPaletteOpen(true)} title="Command palette (⌘K)">⌘K</button>
            </div>
          </div>

          {err && <div className="ck-banner error">Error: {err}</div>}
          {overview?.activeHolds && overview.activeHolds.length > 0 && (
            <div className="ck-banner error">
              {overview.activeHolds.map((h) => (
                <div key={h.id}><strong>Active HOLD · {h.code}</strong> — {h.reason}{h.nextAction ? ` · Next: ${h.nextAction}` : ''}</div>
              ))}
            </div>
          )}
          {!err && !(overview?.activeHolds?.length) && latestHold && session?.status === 'hold' && <div className="ck-banner error">Active HOLD · {latestHold}</div>}
          {(guidance.primary || guidance.secondary) && (
            <div className="ck-composer-actions" style={{ marginBottom: 8 }}>
              {guidance.primary && <button className="ck-btn primary" disabled={guidance.primary.disabled || Boolean(busy)} onClick={guidance.primary.onClick}>{guidance.primary.label}</button>}
              {guidance.secondary && <button className="ck-btn" disabled={guidance.secondary.disabled || Boolean(busy)} onClick={guidance.secondary.onClick}>{guidance.secondary.label}</button>}
            </div>
          )}
          {notice && <div className="ck-banner notice">{notice}</div>}

          <ChatThread
            messages={messages}
            busy={busy}
            canChoose={canGenerate}
            onChoice={handleChoice}
            onAnswer={(answers) => session && action('answer', () => api.answerQuestions(session.id, answers), (x) => { setSession(x.session); setMessages(x.messages) })}
            footer={<ProcessBlock overview={overview} busy={busy} />}
          />

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
            onGenerate={() => session && action('roadmap', () => api.generateRoadmap(session.id), (x) => { setSession(x.session); setMessages(x.messages); if (x.mission) void api.getMissionOverview(x.mission.id).then(setOverview) })}
            canGenerate={canGenerate}
          />
        </div>

        {panels.inspector && (
          <div className="ck-inspector">
            <div className="ck-tabs" role="tablist">
              {INSPECTOR_TABS.map((t) => (
                <button
                  key={t.id}
                  role="tab"
                  aria-selected={tab === t.id}
                  className={`ck-tab${tab === t.id ? ' active' : ''}`}
                  onClick={() => selectTab(t.id)}
                >
                  {t.label}
                  {t.id === 'approvals' && pendingCount > 0 ? <span className="ck-tab-count">{pendingCount}</span> : null}
                </button>
              ))}
            </div>

            <div className="ck-dock">
              {tab === 'roadmap' && (
                <>
                  <ExecutionTimeline
                    overview={overview}
                    busy={busy}
                    onPause={() => session && action('pause', () => api.pauseOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) })}
                    onStop={() => session?.missionId && action('stop', () => api.stopOperatorSession(session.id), (x) => { setSession(x.session); setOverview(x.overview) })}
                    onDiagnose={() => selectTab('monitor')}
                  />
                  <div className="button-row" style={{ marginTop: 10 }}>
                    <button className="action primary" disabled={!session?.missionId || overview?.mission.status === 'approved' || Boolean(busy)} onClick={() => action('approve', () => api.approveRoadmap(session!.id), (x) => { setSession(x.session); setOverview(x.overview) })}>Approve · 批准</button>
                    <button className={`action${overview?.mission.status === 'approved' ? ' primary pulse' : ''}`} disabled={!session?.missionId || overview?.mission.status !== 'approved' || Boolean(busy)} onClick={() => action('start', () => api.startOperatorSession(session!.id), (x) => { setSession(x.session); setOverview(x.overview) })}>{busy === 'start' ? 'Starting… · 启动中' : 'Start · 启动'}</button>
                    <button className="action" disabled={!session?.missionId || Boolean(busy)} onClick={() => action('pause', () => api.pauseOperatorSession(session!.id), (x) => { setSession(x.session); setOverview(x.overview) })}>Pause</button>
                    <button className="action" disabled={!session?.missionId || Boolean(busy)} onClick={() => action('resume', () => api.resumeOperatorSession(session!.id), (x) => { setSession(x.session); setOverview(x.overview) })}>Resume</button>
                    <button className="action" disabled={!session?.missionId || Boolean(busy)} onClick={() => action('draft-pr', () => api.createDraftPr(session!.id), (x) => { setOverview(x.overview); setDraftPrStatus(x.pr?.url ?? `${x.code ?? x.status}: ${x.reason ?? ''}`) })}>Draft PR</button>
                  </div>
                  {draftPrStatus && <div className="running">Draft PR: {draftPrStatus}</div>}
                  <MissionSnapshot overview={overview} />
                </>
              )}
              {tab === 'activity' && <AgentActivity overview={overview} session={session} busy={busy} />}
              {tab === 'diff' && (
                <>
                  <DocumentPreview overview={overview} selectedId={selectedArtifactId} onSelect={setSelectedArtifactId} />
                  <ArtifactList overview={overview} selectedId={selectedArtifactId} onSelect={setSelectedArtifactId} />
                  {draftPrStatus && <div className="running">Draft PR: {draftPrStatus}</div>}
                  {overview?.mission.githubPrUrl && <div className="running">PR: {overview.mission.githubPrUrl}</div>}
                </>
              )}
              {tab === 'monitor' && (
                <>
                  <ExecutionMonitor overview={overview} runLog={runLog} />
                  <RunPanel overview={overview} />
                  <EventLog events={latestEvents} />
                </>
              )}
              {tab === 'approvals' && <ApprovalCard overview={overview} />}
            </div>
          </div>
        )}
      </div>

      <CommandPalette open={paletteOpen} commands={commands} onClose={() => setPaletteOpen(false)} />
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
  latestHold: string | null
  sseConnected: boolean
  onBrainstorm: () => void
  onRoadmap: () => void
  onApprove: () => void
  onStart: () => void
  onPause: () => void
  onResume: () => void
  onDraftPr: () => void
  onReset: () => void
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
  const missionStatus = opts.overview?.mission.status
  const latestRun = opts.overview?.runs?.[0]
  if (missionStatus === 'running' || opts.session?.status === 'running') {
    return {
      kicker: 'Running · 执行中',
      title: 'Worker is running · Worker 正在执行',
      body: 'coder worker 正在运行。模型“思考”时可能一段时间没有新日志，这是正常的，不代表卡住；右侧 Observability 的 run、日志、tokens 会自动刷新。需要的话可以暂停。',
      secondary: { label: 'Pause · 暂停', onClick: opts.onPause, disabled: false },
    }
  }
  if (missionStatus === 'cancelled') {
    return {
      kicker: 'Cancelled · 已取消',
      title: 'Cancelled — background worker result ignored · 已取消',
      body: '已请求停止：mission 已标记 cancelled。正在运行的 worker 即使完成，其结果也会被丢弃，不会覆盖此状态。注意：当前层无法强杀子进程，detached worker 可能在后台继续运行到超时为止（hard-kill 属于 engine follow-up）。',
      primary: { label: 'Start Over · 重新开始', onClick: opts.onReset, disabled: false },
    }
  }
  if (missionStatus === 'failed') {
    const timedOut = latestRun?.exitCode === 124
    return {
      kicker: 'Failed · 执行失败',
      title: timedOut ? 'Worker timed out · Worker 超时' : 'Worker failed · Worker 执行失败',
      body: timedOut
        ? '本次 worker 超出时间预算被中止（exit 124）。任务越大越容易超时——可以把目标拆小后重试，或调大 AEDEV_COCKPIT_WORKER_TIMEOUT_MS。右侧 Observability 有运行日志和已产出的证据。'
        : `本次 worker 失败${latestRun?.exitCode != null ? `（exit ${latestRun.exitCode}）` : ''}。右侧 Observability 的运行日志和证据可用于判断原因，修复后可重新开始。`,
      primary: { label: 'Start Over · 重新开始', onClick: opts.onReset, disabled: false },
      secondary: { label: 'Draft PR · 创建草稿', onClick: opts.onDraftPr, disabled: false },
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
      primary: { label: 'Resume · 恢复执行', onClick: opts.onResume, disabled: false },
      secondary: { label: 'Draft PR · 创建草稿', onClick: opts.onDraftPr, disabled: false },
    }
  }
  if (missionStatus === 'done' || missionStatus === 'waiting' || atEvidenceGate) {
    const validatorsOff = opts.overview?.validatorStatus === 'not_configured'
    return {
      kicker: 'Done · 执行完成',
      title: 'Reached the evidence gate · 已到达证据闸',
      body: validatorsOff
        ? '执行完成，证据已写入（右侧 Observability）。Validator 未配置（缺少 Gemini/OpenAI key）所以未运行；可直接创建草稿 PR。'
        : '执行完成，validator 结果和证据见右侧 Observability；确认无误后可创建草稿 PR。',
      primary: { label: 'Draft PR · 创建草稿', onClick: opts.onDraftPr, disabled: false },
    }
  }
  return {
    kicker: 'Monitor · 监控',
    title: 'Watch the mission move · 查看执行进展',
    body: '右侧是运行状态，中央是方案与审批，左侧可以继续补充上下文。',
  }
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
