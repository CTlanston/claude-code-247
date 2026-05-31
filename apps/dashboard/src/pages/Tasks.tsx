import { useState, useEffect, useMemo } from 'react'
import { api, type ApiTask } from '../api.js'

export function TasksPage() {
  const [tasks, setTasks] = useState<ApiTask[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [query, setQuery] = useState('')

  useEffect(() => {
    const load = () => api.getTasks().then(setTasks).catch((e: Error) => setErr(e.message))
    void load()
    const timer = setInterval(load, 2_000) // live execution view
    return () => clearInterval(timer)
  }, [])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return tasks
    return tasks.filter((t) =>
      t.title.toLowerCase().includes(q) ||
      (t.missionTitle ?? '').toLowerCase().includes(q) ||
      t.id.toLowerCase().includes(q) ||
      t.missionId.toLowerCase().includes(q))
  }, [tasks, query])

  if (err) return <div className="error">Error: {err}</div>
  return (
    <>
      <h1>Tasks · 实时执行</h1>
      <input
        type="text"
        placeholder="Search mission / task title or id · 搜索"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        style={{ width: '100%', maxWidth: 420, margin: '0 0 12px', padding: '6px 10px' }}
      />
      {filtered.length === 0 ? (
        <div className="empty">{tasks.length === 0 ? 'No tasks yet. 启动一个 mission 后会实时出现在这里。' : 'No tasks match your search.'}</div>
      ) : (
        filtered.map((t) => (
          <div key={t.id} className={`card${t.status === 'running' ? ' running' : ''}`}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
              <strong>{t.missionTitle ?? t.title}</strong>
              <span className={`badge badge-${t.status}`}>{t.status}</span>
              {t.repoName && <span className="badge">{t.repoName}</span>}
            </div>
            <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
              {t.title} · mission {t.missionId.slice(0, 8)}
              {t.latestRun && <> · run {t.latestRun.runnerMode}:{t.latestRun.status}{t.latestRun.exitCode != null ? ` (${t.latestRun.exitCode})` : ''}</>}
            </div>
            {t.latestRun?.evidenceDir && <div style={{ fontSize: 11, color: '#475569', marginTop: 2 }}>evidence: {t.latestRun.evidenceDir}</div>}
          </div>
        ))
      )}
    </>
  )
}
