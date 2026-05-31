import { useMemo, useState } from 'react'
import type { ApiOperatorSession, ApiRepo } from '../../api.js'

export function Sidebar({ sessions, repos, activeId, collapsed, onSelect, onNew, onToggle }: {
  sessions: ApiOperatorSession[]
  repos: ApiRepo[]
  activeId: string | null
  collapsed: boolean
  onSelect: (id: string) => void
  onNew: () => void
  onToggle: () => void
}) {
  const [q, setQ] = useState('')

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((s) => `${s.title} ${s.prompt} ${s.status}`.toLowerCase().includes(needle))
  }, [sessions, q])

  // Group missions under their repo (Claude Code groups by folder). Insertion
  // order is preserved; sessions without a repo fall into one trailing group.
  const groups = useMemo(() => {
    const map = new Map<string, ApiOperatorSession[]>()
    for (const s of filtered) {
      const key = s.repoId ?? ''
      const arr = map.get(key)
      if (arr) arr.push(s)
      else map.set(key, [s])
    }
    return [...map.entries()]
  }, [filtered])

  const repoName = (id: string) => repos.find((r) => r.id === id)?.name ?? (id || 'Ungrouped · 未分组')

  if (collapsed) {
    return (
      <aside className="ck-rail">
        <button className="ck-rail-btn" title="Expand history · 展开历史" onClick={onToggle}>☰</button>
        <button className="ck-rail-btn accent" title="New mission · 新任务" onClick={onNew}>+</button>
      </aside>
    )
  }

  return (
    <aside className="ck-sidebar">
      <div className="ck-sidebar-head">
        <strong>Missions · 历史</strong>
        <div className="ck-sidebar-head-actions">
          <button className="ck-btn dark" onClick={onNew}>+ New</button>
          <button className="ck-rail-btn" title="Collapse · 折叠" onClick={onToggle}>‹</button>
        </div>
      </div>
      <input
        className="ck-search"
        placeholder="Search missions · 搜索"
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      <div className="ck-session-list">
        {filtered.length === 0 && <div className="ck-role">No sessions yet · 暂无会话</div>}
        {groups.map(([repoId, items]) => (
          <div className="ck-repo-group" key={repoId || '_none'}>
            <div className="ck-repo-group-head">
              <span className="ck-repo-name">{repoName(repoId)}</span>
              <span className="ck-repo-count">{items.length}</span>
            </div>
            {items.map((s) => (
              <button
                key={s.id}
                className={`ck-session${s.id === activeId ? ' active' : ''}`}
                onClick={() => onSelect(s.id)}
              >
                <span className="ck-session-title">{s.title || s.prompt.slice(0, 48)}</span>
                <span className="ck-session-meta">
                  <span>{new Date(s.updatedAt).toLocaleString()}</span>
                  <span className={`ck-badge ${s.status}`}><span className="bdot" />{s.status}</span>
                </span>
              </button>
            ))}
          </div>
        ))}
      </div>
    </aside>
  )
}
