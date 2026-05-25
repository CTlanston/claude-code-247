import { useState, useEffect } from 'react'
import { api, type ApiApproval } from '../api.js'

export function ApprovalsPage() {
  const [approvals, setApprovals] = useState<ApiApproval[]>([])
  const load = () => api.getApprovals().then(setApprovals)
  useEffect(() => { void load() }, [])
  const pending = approvals.filter((a) => a.status === 'pending')
  return (
    <>
      <h1>Approvals</h1>
      {pending.length === 0 ? (
        <div className="empty">No pending approvals.</div>
      ) : (
        pending.map((a) => (
          <div key={a.id} className="card">
            <strong>{a.entityType}: {a.entityId}</strong>
            <div style={{ fontSize: 13, color: '#94a3b8', margin: '6px 0' }}>{a.requiredReason}</div>
          </div>
        ))
      )}
    </>
  )
}
