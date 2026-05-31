import { useState, useEffect } from 'react'
import { api, type ApiApproval } from '../api.js'

// Must match Cockpit.tsx's SESSION_STORAGE_KEY so "Open in cockpit" resumes the session.
const SESSION_STORAGE_KEY = 'operatorCockpitSessionId'

function ageLabel(ms?: number): string {
  if (ms == null) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return `${Math.floor(s / 86400)}d ago`
}

export function ApprovalsPage({ onNavigate }: { onNavigate?: (tab: string) => void } = {}) {
  const [approvals, setApprovals] = useState<ApiApproval[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const load = () => api.getApprovals().then(setApprovals).catch((e: Error) => setErr(e.message))
  useEffect(() => {
    void load()
    const timer = setInterval(load, 4_000)
    return () => clearInterval(timer)
  }, [])

  const pending = approvals.filter((a) => a.status === 'pending')

  async function decide(a: ApiApproval, decision: 'approve' | 'reject') {
    setBusy(a.id)
    setErr(null)
    try {
      await api.decideApproval(a.id, decision)
      await load()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  function openInCockpit(a: ApiApproval) {
    if (!a.sessionId) return
    localStorage.setItem(SESSION_STORAGE_KEY, a.sessionId)
    onNavigate?.('cockpit')
  }

  return (
    <>
      <h1>Approvals · 审批工作台</h1>
      {err && <div className="error">Error: {err}</div>}
      {pending.length === 0 ? (
        <div className="empty">No pending approvals. 审批通过或拒绝后会从这里消失。</div>
      ) : (
        pending.map((a) => (
          <div key={a.id} className="card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap' }}>
              <strong>{a.mission?.title ?? `${a.entityType}: ${a.entityId}`}</strong>
              {a.repo && <span className="badge">{a.repo.name}</span>}
              <span style={{ fontSize: 12, color: '#64748b' }}>{ageLabel(a.ageMs)}</span>
            </div>
            {a.repo && <div style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{a.repo.path}{a.repo.enabled ? '' : ' · disabled'}</div>}
            <div style={{ fontSize: 13, color: '#94a3b8', margin: '6px 0' }}>{a.requiredReason}</div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button className="action primary" disabled={busy === a.id} onClick={() => decide(a, 'approve')}>Approve · 批准</button>
              <button className="action" disabled={busy === a.id} onClick={() => decide(a, 'reject')}>Reject · 拒绝</button>
              {a.sessionId && <button className="action" onClick={() => openInCockpit(a)}>Open in cockpit · 打开</button>}
            </div>
          </div>
        ))
      )}
    </>
  )
}
