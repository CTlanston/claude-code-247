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
    <div className="ck-obs">
      <ProgressSection overview={overview} />
      <FolderSection overview={overview} repo={repo} />
      <ContextSection overview={overview} session={session} />
    </div>
  )
}

function ProgressSection({ overview }: { overview: ApiMissionOverview | null }) {
  const stages = overview?.stages ?? []
  const rp = overview?.runProgress
  const pct = overview ? Math.round((overview.progress ?? 0) * 100) : 0
  return (
    <section className="ck-obs-sec">
      <div className="ck-obs-head">Progress · 进度{overview ? <span className="ck-obs-pct">{pct}%</span> : null}</div>
      {stages.length ? (
        <ol className="ck-obs-steps">
          {stages.map((s) => (
            <li key={s.stage} className={`ck-obs-step ${s.status}${s.stage === overview?.stage ? ' current' : ''}`}>
              <span className="ck-obs-dot" />
              <span className="ck-obs-step-label">{s.stage}</span>
              <span className="ck-obs-step-status">{s.status}</span>
            </li>
          ))}
        </ol>
      ) : <div className="ck-obs-empty">Generate a roadmap to see progress · 生成方案后显示进度</div>}
      {rp?.lastProgressLabel ? <div className="ck-obs-live">{rp.status === 'running' ? '▶ ' : ''}{rp.lastProgressLabel}</div> : null}
    </section>
  )
}

function FolderSection({ overview, repo }: { overview: ApiMissionOverview | null; repo: ApiRepo | null }) {
  const artifacts = overview?.artifacts ?? []
  return (
    <section className="ck-obs-sec">
      <div className="ck-obs-head">Working folder · 工作目录</div>
      <div className="ck-obs-path">{repo?.path ?? '—'}</div>
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

function ContextSection({ overview, session }: { overview: ApiMissionOverview | null; session: ApiOperatorSession | null }) {
  const events = (overview?.events ?? []).slice(0, 8)
  const validators = overview?.validators ?? []
  return (
    <section className="ck-obs-sec">
      <div className="ck-obs-head">Context · 上下文</div>
      <div className="ck-obs-kv"><span>provider</span><strong>{overview?.cliProvider ?? '—'}</strong></div>
      <div className="ck-obs-kv"><span>session</span><strong>{session?.status ?? '—'}</strong></div>
      <div className="ck-obs-kv"><span>tokens</span><strong>{overview?.cost.totalTokens ?? '—'}</strong></div>
      {overview?.cost.note ? <div className="ck-obs-note">{overview.cost.note}</div> : null}
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
