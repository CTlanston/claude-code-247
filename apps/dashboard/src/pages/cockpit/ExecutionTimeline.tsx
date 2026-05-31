import type { ApiMissionOverview } from '../../api.js'

function fmtElapsed(ms: number | null): string {
  if (ms == null) return '—'
  const s = Math.round(ms / 1000)
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`
}
function cleanEvent(type: string): string {
  return type.replace(/^(operator|mission)\./, '').replace(/[._]/g, ' ')
}
function nextAction(status: string): string {
  if (status === 'failed' || status === 'cancelled') return 'Fix & Start Over, or narrow the scope'
  if (status === 'waiting' || status === 'paused') return 'Resume, or create a Draft PR'
  if (status === 'done') return 'Create a Draft PR'
  return '—'
}

/** Live execution timeline + stalled detection + completion summary (PRD §E). */
export function ExecutionTimeline({ overview, busy, onPause, onStop, onDiagnose }: {
  overview: ApiMissionOverview | null
  busy: string | null
  onPause: () => void
  onStop: () => void
  onDiagnose: () => void
}) {
  if (!overview) {
    return <div className="empty">Generate & approve a roadmap, then Start to see the live execution timeline.</div>
  }
  const stages = overview.stages ?? []
  const rp = overview.runProgress
  const status = overview.mission.status
  const terminal = ['done', 'failed', 'paused', 'cancelled', 'waiting'].includes(status)
  const recent = overview.events.slice(0, 5)

  return (
    <div className="ck-exec">
      <div className="timeline">
        {stages.map((s) => <div key={s.stage} className={`stage ${s.status}`}>{s.stage}</div>)}
        <div className="progress"><span style={{ width: `${Math.round((overview.progress ?? 0.08) * 100)}%` }} /></div>
        <div className="mission-meta">{overview.mission.title} · {status}</div>
      </div>

      <div className="ck-exec-live">
        <div className="metric-row"><span>Stage</span><strong>{overview.stage}</strong></div>
        <div className="metric-row"><span>Worker</span><strong>{overview.cliProvider}</strong></div>
        {rp && (
          <>
            <div className="metric-row"><span>Run</span><strong>{rp.status}{rp.exitCode != null ? ` (exit ${rp.exitCode})` : ''}</strong></div>
            <div className="metric-row"><span>Elapsed</span><strong>{fmtElapsed(rp.elapsedMs)}</strong></div>
            <div className="metric-row"><span>Last heartbeat</span><strong>{rp.sinceHeartbeatMs != null ? `${fmtElapsed(rp.sinceHeartbeatMs)} ago` : '—'}</strong></div>
            <div className="metric-row"><span>Last update</span><strong>{rp.lastProgressLabel || '—'}</strong></div>
          </>
        )}
      </div>

      {rp?.stalled && (
        <div className="ck-banner error" style={{ marginTop: 8 }}>
          ⚠ Possibly stalled · 可能卡住了 — no new worker output for {fmtElapsed(rp.sinceHeartbeatMs)}. The model may be reasoning silently, or the run is stuck.
          <div className="ck-composer-actions" style={{ marginTop: 6 }}>
            <button className="ck-btn" disabled={Boolean(busy)} onClick={onDiagnose}>Diagnose · 查看日志</button>
            <button className="ck-btn" disabled={Boolean(busy)} onClick={onPause}>Pause · 暂停</button>
            <button className="ck-btn dark" disabled={Boolean(busy)} onClick={onStop}>Stop · 停止</button>
          </div>
        </div>
      )}

      {terminal && (
        <div className="ck-exec-summary">
          <div className="subhead">Summary · 总结</div>
          <div className="metric-row"><span>Result</span><strong>{status}</strong></div>
          <div className="metric-row"><span>Evidence</span><strong>{overview.evidenceDir ?? 'none'}</strong></div>
          <div className="metric-row"><span>Tests / Runs</span><strong>{overview.runs.map((r) => `${r.runnerMode}:${r.status}${r.exitCode != null ? `(${r.exitCode})` : ''}`).join(', ') || 'none'}</strong></div>
          <div className="metric-row"><span>Validators</span><strong>{overview.validatorStatus ?? 'n/a'}{overview.validators.length ? `: ${overview.validators.map((v) => v.verdict).join(', ')}` : ''}</strong></div>
          <div className="metric-row"><span>PR</span><strong>{overview.mission.githubPrUrl ?? 'not created'}</strong></div>
          <div className="metric-row"><span>Next</span><strong>{nextAction(status)}</strong></div>
        </div>
      )}

      <div className="ck-exec-feed">
        <div className="subhead">Recent · 最近</div>
        {recent.length ? recent.map((e) => (
          <div className="activity-row" key={e.id}>
            <strong>{cleanEvent(e.type)}</strong>
            {e.payload && e.payload['stage'] ? <span>→ {String(e.payload['stage'])}</span> : null}
          </div>
        )) : <p>No events yet.</p>}
      </div>
    </div>
  )
}
