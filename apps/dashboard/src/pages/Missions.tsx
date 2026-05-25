import { useState, useEffect } from 'react'
import { api, type ApiMission } from '../api.js'

function statusBadge(s: string) {
  return <span className={`badge badge-${s}`}>{s}</span>
}

export function MissionsPage() {
  const [missions, setMissions] = useState<ApiMission[]>([])
  const [err, setErr] = useState<string | null>(null)

  const load = () => api.getMissions().then(setMissions).catch((e: Error) => setErr(e.message))
  useEffect(() => { void load() }, [])

  if (err) return <div className="error">Error: {err}</div>
  if (missions.length === 0) return <div className="empty">No missions yet. Run: aedev intake "..."</div>

  return (
    <>
      <h1>Missions</h1>
      {missions.map((m) => (
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
