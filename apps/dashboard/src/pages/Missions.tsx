import { useState, useEffect } from 'react'
import { api, type ApiMission, type ApiOperatorSession } from '../api.js'

function statusBadge(s: string) {
  return <span className={`badge badge-${s}`}>{s}</span>
}

/**
 * cloudhull-c5 — group operator sessions by the submitting user's display
 * name (trusted-local multi-user; backfill 'owner' for unnamed sessions).
 * Exported for tests.
 */
export function groupSessionsBySubmitter(sessions: ApiOperatorSession[]): Array<[string, ApiOperatorSession[]]> {
  const groups = new Map<string, ApiOperatorSession[]>()
  for (const s of sessions) {
    const name = s.submittedBy?.trim() || 'owner'
    const list = groups.get(name) ?? []
    list.push(s)
    groups.set(name, list)
  }
  return [...groups.entries()]
}

function SessionsBySubmitter({ sessions }: { sessions: ApiOperatorSession[] }) {
  if (sessions.length === 0) return null
  return (
    <>
      <h2 style={{ fontSize: 15, margin: '8px 0' }}>Sessions · 会话（按提交人 · by submitter）</h2>
      {groupSessionsBySubmitter(sessions).map(([name, list]) => (
        <div key={name} className="card" data-testid="missions-session-group" data-submitted-by={name}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
            <strong data-testid="missions-session-submitter">{name}</strong>
            <span style={{ fontSize: 12, color: '#64748b' }}>{list.length} session{list.length === 1 ? '' : 's'}</span>
          </div>
          {list.map((s) => (
            <div key={s.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, padding: '2px 0' }}>
              <span>{s.title}</span>
              {statusBadge(s.status)}
            </div>
          ))}
        </div>
      ))}
    </>
  )
}

export function MissionsPage() {
  const [missions, setMissions] = useState<ApiMission[]>([])
  const [sessions, setSessions] = useState<ApiOperatorSession[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = () => api.getMissions().then(setMissions).catch((e: Error) => setErr(e.message))
  useEffect(() => {
    void load()
    api.listOperatorSessions().then(setSessions).catch(() => undefined)
  }, [])

  if (err) return <div className="error">Error: {err}</div>

  return (
    <>
      <h1>Missions</h1>
      <SessionsBySubmitter sessions={sessions} />
      {missions.length === 0 ? (
        <div className="empty">No missions yet. Run: aedev intake "..."</div>
      ) : missions.map((m) => (
        <div key={m.id} className="card">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
            <strong>{m.title}</strong>
            {statusBadge(m.status)}
            {m.githubPrUrl && <a href={m.githubPrUrl} style={{ color: '#60a5fa', fontSize: 13 }}>PR #{m.githubPrNumber}</a>}
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginBottom: 10 }}>{m.id}</div>
          <div style={{ display: 'flex', gap: 6 }}>
            {m.status === 'draft' && (
              <button className="action" onClick={() => api.approveMission(m.id).then(load)}>Approve</button>
            )}
            {m.status === 'running' && (
              <button className="action" onClick={() => api.pauseMission(m.id).then(load)}>Pause</button>
            )}
            {m.status === 'paused' && (
              <button className="action" onClick={() => api.resumeMission(m.id).then(load)}>Resume</button>
            )}
            {!['done', 'cancelled', 'failed'].includes(m.status) && (
              <button className="action danger" onClick={() => api.cancelMission(m.id).then(load)}>Cancel</button>
            )}
          </div>
        </div>
      ))}
    </>
  )
}
