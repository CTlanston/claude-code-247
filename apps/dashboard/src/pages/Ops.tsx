import { useState, useEffect } from 'react'
import { api, type ApiOpsOverview, type ApiEngineStatus } from '../api.js'

/** cloudhull-c6 — the owner's single read-only "Operations" view.
 *  Humanized text only; machine codes live exclusively in data-* attributes.
 *  No buttons, no mutation calls, and the daemon side never probes engines
 *  for this page (a claude probe costs real subscription credit). */

const ENGINE_LABEL: Record<ApiEngineStatus, string> = {
  unknown: 'Unknown · 未知',
  ready: 'Ready · 就绪',
  needs_login: 'Needs login · 需要登录',
  not_configured: 'Not configured · 未配置',
}
const ENGINE_COLOR: Record<ApiEngineStatus, string> = {
  unknown: '#94a3b8',
  ready: '#22c55e',
  needs_login: '#f59e0b',
  not_configured: '#94a3b8',
}
const ENGINE_NAME: Record<'claude' | 'codex' | 'gemini', string> = {
  claude: 'Claude — planner · 规划',
  codex: 'Codex — worker · 执行',
  gemini: 'Gemini — reviewer · 评审',
}
const MISSION_STATUS_LABEL: Record<string, string> = {
  draft: 'Draft · 草稿',
  pending_approval: 'Waiting for approval · 等待确认',
  approved: 'Approved · 已批准',
  running: 'Working · 进行中',
  paused: 'Paused · 已暂停',
}

function sectionTitle(text: string) {
  return <h2 style={{ fontSize: 14, color: '#64748b' }}>{text}</h2>
}

export function OpsPage() {
  const [overview, setOverview] = useState<ApiOpsOverview | null>(null)
  useEffect(() => { void api.getOpsOverview().then(setOverview) }, [])
  if (!overview) return <div data-testid="ops-page"><h1>Operations</h1><div className="empty">Loading…</div></div>
  const engines = (['claude', 'codex', 'gemini'] as const)
  return (
    <div data-testid="ops-page">
      <h1>Operations</h1>

      <section data-testid="ops-recovery" className="card" style={{ borderLeft: '4px solid #f59e0b' }}>
        {sectionTitle('What needs you · 需要你处理')}
        {overview.suggestedRecovery.length === 0 ? (
          <div style={{ color: '#22c55e' }}>Nothing needs your attention right now · 目前不需要你做任何事</div>
        ) : (
          overview.suggestedRecovery.map((action, i) => (
            <div key={i} style={{ fontWeight: 600, marginTop: i === 0 ? 0 : 8 }}>{action}</div>
          ))
        )}
      </section>

      {sectionTitle('Engines · 引擎')}
      {engines.map((name) => (
        <div key={name} className="card" data-engine={name} data-engine-status={overview.engines[name]}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <strong>{ENGINE_NAME[name]}</strong>
            <span style={{ fontSize: 12, color: ENGINE_COLOR[overview.engines[name]] }}>
              {ENGINE_LABEL[overview.engines[name]]}
            </span>
          </div>
        </div>
      ))}

      {sectionTitle('Active blockers · 当前阻塞')}
      {overview.activeHolds.length === 0 ? (
        <div className="empty">No active blockers · 没有阻塞</div>
      ) : (
        overview.activeHolds.map((h) => (
          <div key={`${h.code}:${h.entityId}:${h.createdAt}`} className="card" data-code={h.code} data-entity-id={h.entityId}>
            <div>{h.text}</div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>since {h.createdAt}</div>
          </div>
        ))
      )}

      {sectionTitle('Active missions · 进行中的任务')}
      {overview.activeMissions.length === 0 ? (
        <div className="empty">No active missions · 没有进行中的任务</div>
      ) : (
        overview.activeMissions.map((m) => (
          <div key={m.id} className="card" data-mission-id={m.id} data-status={m.status}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
              <strong>{m.title}</strong>
              <span style={{ fontSize: 12, color: '#64748b' }}>{MISSION_STATUS_LABEL[m.status] ?? m.status}</span>
            </div>
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>submitted by {m.submittedBy} · 提交人 {m.submittedBy}</div>
          </div>
        ))
      )}

      {sectionTitle('Last review · 最近一次评审')}
      <div className="card" data-validator-status={overview.lastValidator?.status ?? 'none'}>
        {!overview.lastValidator ? (
          <div style={{ color: '#94a3b8' }}>No review has run yet · 还没有评审记录</div>
        ) : overview.lastValidator.status === 'not_configured' ? (
          <div>Result review is not set up yet · 结果评审尚未配置</div>
        ) : (
          <div>
            Verdict: <strong>{overview.lastValidator.verdict ?? '—'}</strong>
            <span style={{ fontSize: 12, color: '#94a3b8', marginLeft: 8 }}>at {overview.lastValidator.atIso}</span>
          </div>
        )}
      </div>

      {sectionTitle('Publishing · 对外发布')}
      <div className="card" data-remote-writes={overview.remoteWrites.enabled ? 'enabled' : 'disabled'}>
        {overview.remoteWrites.enabled ? (
          <div>
            Publishing to GitHub is ON · 已允许推送到 GitHub
            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 6 }}>
              allowed repos · 允许的仓库: {overview.remoteWrites.whitelist.length > 0 ? overview.remoteWrites.whitelist.join(', ') : 'none yet · 暂无'}
            </div>
          </div>
        ) : (
          <div>Publishing is OFF — nothing leaves this Mac · 不会向外推送任何内容</div>
        )}
      </div>
    </div>
  )
}
