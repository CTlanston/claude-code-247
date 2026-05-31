import type { ApiRepo } from '../../api.js'

export function Composer(props: {
  mode: 'new' | 'session'
  busy: string | null
  draft: string
  onDraftChange: (v: string) => void
  // new-mission fields
  repos: ApiRepo[]
  repoId: string
  onRepoChange: (v: string) => void
  title: string
  onTitleChange: (v: string) => void
  // actions
  onBrainstorm: () => void
  onAddNote: () => void
  onAsk: () => void
  onGenerate: () => void
  canGenerate: boolean
}) {
  const busy = Boolean(props.busy)
  const selectedRepo = props.repos.find((r) => r.id === props.repoId)
  if (props.mode === 'new') {
    return (
      <div className="ck-composer">
        <div className="ck-new-fields">
          <div>
            <label>Repo · 仓库</label>
            <select value={props.repoId} onChange={(e) => props.onRepoChange(e.target.value)}>
              {props.repos.length === 0 && <option value="unknown">unknown</option>}
              {props.repos.map((r) => <option key={r.id} value={r.id}>{r.name} · {r.path}{r.enabled ? '' : ' · disabled'}</option>)}
            </select>
            {selectedRepo && (
              <div className="ck-repo-preflight" style={{ fontSize: 11, color: '#64748b', marginTop: 2 }}>
                {selectedRepo.path} · {selectedRepo.enabled ? 'enabled' : 'disabled — start will HOLD'} · the worker runs in an isolated git worktree of this repo
              </div>
            )}
          </div>
          <div>
            <label>Title · 标题</label>
            <input type="text" value={props.title} onChange={(e) => props.onTitleChange(e.target.value)} />
          </div>
        </div>
        <textarea
          placeholder="Describe your goal · 描述你的目标，AI 会先讨论再确认方案"
          value={props.draft}
          onChange={(e) => props.onDraftChange(e.target.value)}
        />
        <div className="ck-composer-actions">
          <button className="ck-btn primary" disabled={busy || !props.draft.trim()} onClick={props.onBrainstorm}>
            Start Brainstorm · 开始讨论
          </button>
        </div>
      </div>
    )
  }
  return (
    <div className="ck-composer">
      <textarea
        placeholder="Add a constraint or reply · 补充约束或回复，然后 Add Note"
        value={props.draft}
        onChange={(e) => props.onDraftChange(e.target.value)}
      />
      <div className="ck-composer-actions">
        <button className="ck-btn" disabled={busy || !props.draft.trim()} onClick={props.onAddNote}>Add Note · 补充</button>
        <button className="ck-btn" disabled={busy} onClick={props.onAsk}>Ask 3 Questions · 问我 3 个问题</button>
        <button className={`ck-btn primary${props.canGenerate ? ' pulse' : ''}`} disabled={busy} onClick={props.onGenerate}>Generate PRD · 生成方案</button>
      </div>
    </div>
  )
}
