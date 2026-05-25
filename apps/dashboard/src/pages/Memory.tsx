import { useState, useEffect } from 'react'
import { api, type ApiMemoryItem } from '../api.js'

export function MemoryPage() {
  const [items, setItems] = useState<ApiMemoryItem[]>([])
  const load = () => api.getMemory().then(setItems)
  useEffect(() => { void load() }, [])
  return (
    <>
      <h1>Memory</h1>
      {items.length === 0 ? (
        <div className="empty">No memory items yet.</div>
      ) : (
        items.map((m) => (
          <div key={m.id} className="card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
              <strong>{m.title}</strong>
              <span className={`badge badge-${m.approved ? 'done' : 'draft'}`}>
                {m.approved ? 'approved' : 'pending'}
              </span>
            </div>
            <pre style={{ fontSize: 12, color: '#94a3b8', whiteSpace: 'pre-wrap' }}>{m.content}</pre>
            {!m.approved && (
              <button className="action" style={{ marginTop: 10 }} onClick={() => api.approveMemory(m.id).then(load)}>
                Approve
              </button>
            )}
          </div>
        ))
      )}
    </>
  )
}
