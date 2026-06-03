import type { ApiMissionOverview, ApiOperatorSession, ApiRepo } from '../../api.js'

/**
 * Cowork-style observation panel (redesign v2, P2). Read-only situational
 * awareness only — Progress / Working folder / Context. All actions live inline
 * in the conversation (coach card), never here.
 */
export function Observation({ overview, repo, session }: {
  overview: ApiMissionOverview | null
  repo: ApiRepo | null
  session: ApiOperatorSession | null
}) {
  return (
    <div className="ck-obs" data-testid="project-pulse">
      <div className="ck-obs-title">
        <strong>Project Pulse · 项目脉搏</strong>
        <span>read-only</span>
      </div>
      <MemorySection overview={overview} />
      <ProgressSection overview={overview} />
      <FolderSection overview={overview} repo={repo} />
      <ValidatorSection overview={overview} />
      <ContextSection overview={overview} session={session} />
    </div>
  )
}

function ProgressSection({ overview }: { overview: ApiMissionOverview | null }) {
  const view = overview?.operatorView
  const stages = view?.projectPulse.progress ?? (view ? operatorStages(view.stage) : overview?.stages ?? [])
  const rp = overview?.runProgress
  const pct = view ? view.progressPercent : overview ? Math.round((overview.progress ?? 0) * 100) : 0
  return (
    <section className="ck-obs-sec">
      <div className="ck-obs-head">Progress · 进度{overview ? <span className="ck-obs-pct">{pct}%</span> : null}</div>
      {view ? <div className="ck-obs-live" data-testid="mission-stage-observation" data-stage={view.stage}>{view.stageLabel}</div> : null}
      {stages.length ? (
        <ol className="ck-obs-steps">
          {stages.map((s) => (
            <li key={'id' in s ? s.id : s.stage} className={`ck-obs-step ${s.status}${('id' in s && s.status === 'active') || ('stage' in s && s.stage === (view?.stage ?? overview?.stage)) ? ' current' : ''}`}>
              <span className="ck-obs-dot" />
              <span className="ck-obs-step-label">{'label' in s ? s.label : s.stage}</span>
              <span className="ck-obs-step-status">{s.status}</span>
              {'detail' in s && s.detail ? <span className="ck-obs-step-detail">{s.detail}</span> : null}
            </li>
          ))}
        </ol>
      ) : <div className="ck-obs-empty">Generate a roadmap to see progress · 生成方案后显示进度</div>}
      {rp?.lastProgressLabel ? <div className="ck-obs-live">{rp.status === 'running' ? '▶ ' : ''}{rp.lastProgressLabel}</div> : null}
    </section>
  )
}

function FolderSection({ overview, repo }: { overview: ApiMissionOverview | null; repo: ApiRepo | null }) {
  const pulse = overview?.operatorView?.projectPulse
  const artifacts = pulse?.evidence ?? overview?.artifacts ?? []
  const touched = pulse?.touchedFiles ?? []
  return (
    <section className="ck-obs-sec">
      <div className="ck-obs-head">Working folder · 工作目录</div>
      <div className="ck-obs-path">{pulse?.workingFolder ?? repo?.path ?? '—'}</div>
      {touched.length ? (
        <>
          <div className="ck-obs-subhead">Touched files · 改动文件</div>
          <ul className="ck-obs-files">
            {touched.map((path) => <li key={path} className="ck-obs-file"><span className="ck-obs-file-type">diff</span><span className="ck-obs-file-name">{path}</span></li>)}
          </ul>
        </>
      ) : null}
      {artifacts.length ? (
        <ul className="ck-obs-files">
          {artifacts.map((a) => (
            <li key={a.id} className="ck-obs-file">
              <span className="ck-obs-file-type">{a.type}</span>
              <span className="ck-obs-file-name">{a.title ?? a.path}</span>
            </li>
          ))}
        </ul>
      ) : <div className="ck-obs-empty">No files yet · 暂无产出文件</div>}
      {overview?.evidenceDir ? <div className="ck-obs-kv"><span>evidence</span><code>{overview.evidenceDir}</code></div> : null}
      {overview?.mission.githubPrUrl ? (
        <div className="ck-obs-kv"><span>PR</span><a href={overview.mission.githubPrUrl} target="_blank" rel="noreferrer">{overview.mission.githubPrUrl}</a></div>
      ) : null}
    </section>
  )
}

function MemorySection({ overview }: { overview: ApiMissionOverview | null }) {
  const memory = overview?.operatorView?.memorySummary
  const facts = [
    ...(memory?.projectFacts ?? []),
    ...(memory?.userPreferences ?? []),
    ...(memory?.recentLessons ?? []),
  ].slice(0, 5)
  return (
    <section className="ck-obs-sec" data-testid="project-brain">
      <div className="ck-obs-head">Project Brain · 项目记忆</div>
      {facts.length ? (
        <ul className="ck-obs-events">
          {facts.map((f) => (
            <li key={f.id} className="ck-obs-event">
              {f.text}
              <span className="ck-obs-provenance">{f.provenance} · ttl {f.ttlDays}d</span>
            </li>
          ))}
        </ul>
      ) : <div className="ck-obs-empty">Start a mission to project known context · 开始任务后显示已知上下文</div>}
    </section>
  )
}

function ValidatorSection({ overview }: { overview: ApiMissionOverview | null }) {
  const reviews = overview?.operatorView?.projectPulse.validatorReviews ?? []
  return (
    <section className="ck-obs-sec" data-testid="validator-reviews">
      <div className="ck-obs-head">Independent Review · 独立验证</div>
      {reviews.length ? reviews.map((r) => (
        <div key={r.id} className={`ck-validator ${r.verdict}`}>
          <div className="ck-validator-top"><strong>{r.validator}</strong><span>{r.verdict}</span></div>
          <div className="ck-obs-note">{r.summary}</div>
          <div className="ck-obs-note">Evidence-only · 只看 evidence，不看 coder 对话。</div>
          {r.checkedEvidence.length ? <div className="ck-obs-note">Checked: {r.checkedEvidence.join(', ')}</div> : null}
          {r.blockingIssues.length ? <div className="ck-obs-note">Blocking: {r.blockingIssues.join('; ')}</div> : null}
          {r.evidenceGaps.length ? <div className="ck-obs-note">Gaps: {r.evidenceGaps.join('; ')}</div> : null}
          <div className="ck-obs-note">Next: {r.recommendedNextAction}</div>
        </div>
      )) : <div className="ck-obs-empty">Validator review appears after evidence · 证据完成后显示独立验证</div>}
    </section>
  )
}

function ContextSection({ overview, session }: { overview: ApiMissionOverview | null; session: ApiOperatorSession | null }) {
  const events = (overview?.events ?? []).slice(0, 8)
  const validators = overview?.validators ?? []
  const provider = overview?.operatorView?.providerSummary
  return (
    <section className="ck-obs-sec">
      <div className="ck-obs-head">Context · 上下文</div>
      <div className="ck-obs-kv"><span>Planner</span><strong>{provider?.planner ? `${provider.planner.name} · ${provider.planner.mode}` : '—'}</strong></div>
      <div className="ck-obs-kv"><span>Worker</span><strong>{provider?.worker ? `${provider.worker.name} · ${provider.worker.status ?? provider.worker.mode}` : '—'}</strong></div>
      <div className="ck-obs-kv"><span>Validators</span><strong>{provider?.validators.map((v) => `${v.name}:${v.status ?? v.mode}`).join(', ') ?? '—'}</strong></div>
      <div className="ck-obs-kv"><span>session</span><strong>{session?.status ?? '—'}</strong></div>
      <div className="ck-obs-kv"><span>tokens</span><strong>{overview?.cost.totalTokens ?? '—'}</strong></div>
      {overview?.cost.note ? <div className="ck-obs-note">{overview.cost.note}</div> : null}
      {overview?.validatorStatus === 'not_configured' ? (
        <div className="ck-obs-note">验证未运行，因为 Gemini/OpenAI key 未配置 · Validators did not run because keys are not configured.</div>
      ) : null}
      {validators.map((v) => (
        <div key={v.id} className="ck-obs-kv"><span>{v.validator}</span><strong>{v.verdict}</strong></div>
      ))}
      <div className="ck-obs-subhead">Recent activity · 最近动作</div>
      {events.length ? (
        <ul className="ck-obs-events">
          {events.map((e) => (
            <li key={e.id} className="ck-obs-event">{e.type.replace(/^(operator|mission)\./, '')}</li>
          ))}
        </ul>
      ) : <div className="ck-obs-empty">No activity yet · 暂无活动</div>}
    </section>
  )
}

function operatorStages(current: string): Array<{ stage: string; status: string }> {
  const stages = ['new', 'brainstorming', 'clarifying', 'roadmap_ready', 'pending_approval', 'approved', 'running', 'evidence_ready', 'validators_missing', 'validators_ready', 'pr_blocked', 'pr_ready', 'pr_created']
  const idx = stages.indexOf(current)
  return stages.map((stage, i) => ({
    stage,
    status: idx < 0 ? 'pending' : i < idx ? 'done' : i === idx ? 'active' : 'pending',
  }))
}
