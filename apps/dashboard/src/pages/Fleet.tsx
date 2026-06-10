import { useState, useEffect } from 'react'
import { api, type ApiFleetOverview } from '../api.js'

/** v5-P3 read-only squad view: who is running what + per-operator credit
 *  counts and holds. Strictly read-only — no buttons, no mutation calls;
 *  write actions stay owner-only and live elsewhere. */
export function FleetPage() {
  const [overview, setOverview] = useState<ApiFleetOverview | null>(null)
  useEffect(() => { void api.getFleetOverview().then(setOverview) }, [])
  return (
    <>
      <h1>Fleet</h1>
      <h2 style={{ fontSize: 14, color: '#64748b' }}>Workers</h2>
      {!overview || overview.workers.length === 0 ? (
        <div className="empty">No fleet workers registered yet.</div>
      ) : (
        overview.workers.map((w) => (
          <div key={w.workerId} className="card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <strong>{w.workerId}</strong>
              <span className={`badge badge-${w.status === 'active' ? 'done' : 'draft'}`}>{w.status}</span>
              <span style={{ fontSize: 12, color: '#64748b' }}>operator: {w.operatorId}</span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              last seen: {w.lastSeenAt ?? 'never'} · claimed: {w.claimedTaskIds.length > 0 ? w.claimedTaskIds.join(', ') : 'none'}
            </div>
          </div>
        ))
      )}
      <h2 style={{ fontSize: 14, color: '#64748b' }}>Operators</h2>
      {!overview || overview.operators.length === 0 ? (
        <div className="empty">No operators yet.</div>
      ) : (
        overview.operators.map((o) => (
          <div key={o.operatorId} className="card">
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <strong>{o.operatorId}</strong>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>{o.headlessCallsToday} calls today</span>
            </div>
            {o.activeHolds.map((h) => (
              <div key={`${h.code}:${h.entityId}`} style={{ fontSize: 12, color: '#f87171', marginTop: 6 }}>
                {h.code} — {h.reason}
              </div>
            ))}
          </div>
        ))
      )}
    </>
  )
}
