import { useState, useEffect } from 'react'
import { api, type ApiTask } from '../api.js'

export function TasksPage() {
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [err, setErr] = useState<string | null>(null)
  useEffect(() => { api.getTasks().then(setTasks).catch((e: Error) => setErr(e.message)) }, [])
  if (err) return <div className="error">Error: {err}</div>
  if (tasks.length === 0) return <div className="empty">No tasks yet.</div>
  return (
    <>
      <h1>Tasks</h1>
      {tasks.map((t) => (
        <div key={t.id} className="card">
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <strong>{t.title}</strong>
            <span className={`badge badge-${t.status}`}>{t.status}</span>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>Mission: {t.missionId}</div>
        </div>
      ))}
    </>
  )
}
