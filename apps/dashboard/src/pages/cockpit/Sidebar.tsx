import { useMemo, useState } from 'react'
import type { ApiOperatorSession } from '../../api.js'

export function Sidebar({ sessions, activeId, onSelect, onNew }: {
  sessions: ApiOperatorSession[]
  activeId: string | null
  onSelect: (id: string) => void
  onNew: () => void
}) {
  const [q, setQ] = useState('')
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((s) => `${s.title} ${s.prompt} ${s.status}`.toLowerCase().includes(needle))
  }, [sessions, q])

  return (
    <aside className="ck-sidebar">
      <div className="ck-sidebar-head">
        <strong>Missions · 历史</strong>
        <button className="ck-btn dark" onClick={onNew}>+ New</button>
      </div>
      <input
        className="ck-search"
        placeholder="Search missions · 搜索"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="ck-session-list">
        {filtered.length === 0 && <div className="ck-role">No sessions yet · 暂无会话</div>}
        {filtered.map((s) => (
          <button
            key={s.id}
            className={`ck-session${s.id === activeId ? ' active' : ''}`}
            onClick={() => onSelect(s.id)}
          >
            <span className="ck-session-title">{s.title || s.prompt.slice(0, 48)}</span>
            <span className="ck-session-meta">
              <span>{new Date(s.updatedAt).toLocaleString()}</span>
              <span className={`ck-badge ${s.status}`}>{s.status}</span>
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}
