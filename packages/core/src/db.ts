import Database from 'better-sqlite3'
import { runMigrations } from './migrations.js'
import { generateId, nowIso } from './ids.js'
import type { Repo, Mission, Task, Run, Approval, Event, RiskScore, ValidatorResult, MemoryItem } from './schema.js'
import type { RiskLevel, RunnerMode, ValidatorName, ValidatorVerdict } from './schema.js'

export class AedevDb {
  private db: Database.Database

  constructor(dbPath: string = ':memory:') {
    this.db = new Database(dbPath)
    this.db.pragma('journal_mode = WAL')
    this.db.pragma('foreign_keys = ON')
    runMigrations(this.db)
  }

  close(): void { this.db.close() }

  // --- Repos ---
  insertRepo(r: Omit<Repo, 'id' | 'createdAt' | 'updatedAt'>): Repo {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO repos (id,name,path,github_owner,github_repo,default_branch,enabled,test_commands,forbidden_paths,risk_rules,merge_policy,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, r.name, r.path, r.githubOwner ?? null, r.githubRepo ?? null, r.defaultBranch,
      r.enabled ? 1 : 0, JSON.stringify(r.testCommands), JSON.stringify(r.forbiddenPaths),
      JSON.stringify(r.riskRules), r.mergePolicy, now, now
    )
    return { ...r, id, createdAt: now, updatedAt: now }
  }

  getRepo(id: string): Repo | undefined {
    const row = this.db.prepare('SELECT * FROM repos WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToRepo(row) : undefined
  }

  listRepos(): Repo[] {
    const rows = this.db.prepare('SELECT * FROM repos').all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToRepo(r))
  }

  private rowToRepo(r: Record<string, unknown>): Repo {
    return {
      id: r['id'] as string, name: r['name'] as string, path: r['path'] as string,
      githubOwner: r['github_owner'] as string | undefined,
      githubRepo: r['github_repo'] as string | undefined,
      defaultBranch: r['default_branch'] as string,
      enabled: r['enabled'] === 1, mergePolicy: r['merge_policy'] as string,
      testCommands: JSON.parse(r['test_commands'] as string) as string[],
      forbiddenPaths: JSON.parse(r['forbidden_paths'] as string) as string[],
      riskRules: JSON.parse(r['risk_rules'] as string) as Record<string, unknown>,
      createdAt: r['created_at'] as string, updatedAt: r['updated_at'] as string,
    }
  }

  // --- Missions ---
  insertMission(m: Omit<Mission, 'id' | 'createdAt' | 'updatedAt'>): Mission {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO missions (id,roadmap_id,repo_id,title,description,status,risk_level,prd_path,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id, m.roadmapId ?? null, m.repoId, m.title, m.description ?? null,
      m.status, m.riskLevel ?? null, m.prdPath ?? null, now, now
    )
    return { ...m, id, createdAt: now, updatedAt: now }
  }

  getMission(id: string): Mission | undefined {
    const row = this.db.prepare('SELECT * FROM missions WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToMission(row) : undefined
  }

  updateMissionStatus(id: string, status: string): void {
    this.db.prepare('UPDATE missions SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id)
  }

  updateMissionGitHub(id: string, fields: { githubBranch?: string; githubPrUrl?: string; githubPrNumber?: number }): void {
    const sets: string[] = []
    const vals: unknown[] = []
    if (fields.githubBranch !== undefined) { sets.push('github_branch = ?'); vals.push(fields.githubBranch) }
    if (fields.githubPrUrl !== undefined) { sets.push('github_pr_url = ?'); vals.push(fields.githubPrUrl) }
    if (fields.githubPrNumber !== undefined) { sets.push('github_pr_number = ?'); vals.push(fields.githubPrNumber) }
    if (sets.length === 0) return
    vals.push(nowIso(), id)
    this.db.prepare(`UPDATE missions SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals)
  }

  listMissions(repoId?: string): Mission[] {
    const rows = repoId
      ? this.db.prepare('SELECT * FROM missions WHERE repo_id = ?').all(repoId) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM missions').all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToMission(r))
  }

  private rowToMission(r: Record<string, unknown>): Mission {
    return {
      id: r['id'] as string, repoId: r['repo_id'] as string,
      roadmapId: r['roadmap_id'] as string | undefined, title: r['title'] as string,
      description: r['description'] as string | undefined,
      status: r['status'] as Mission['status'],
      riskLevel: r['risk_level'] as RiskLevel | undefined,
      prdPath: r['prd_path'] as string | undefined,
      githubBranch: r['github_branch'] as string | undefined,
      githubPrUrl: r['github_pr_url'] as string | undefined,
      githubPrNumber: r['github_pr_number'] as number | undefined,
      createdAt: r['created_at'] as string, updatedAt: r['updated_at'] as string,
    }
  }

  // --- Tasks ---
  insertTask(t: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>): Task {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO tasks (id,mission_id,repo_id,title,prompt,status,attempt_number,parent_task_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id, t.missionId, t.repoId, t.title, t.prompt, t.status, t.attemptNumber,
      t.parentTaskId ?? null, now, now
    )
    return { ...t, id, createdAt: now, updatedAt: now }
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare('SELECT * FROM tasks WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToTask(row) : undefined
  }

  updateTaskStatus(id: string, status: string): void {
    this.db.prepare('UPDATE tasks SET status = ?, updated_at = ? WHERE id = ?').run(status, nowIso(), id)
  }

  listTasks(missionId?: string): Task[] {
    const rows = missionId
      ? this.db.prepare('SELECT * FROM tasks WHERE mission_id = ?').all(missionId) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM tasks').all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToTask(r))
  }

  private rowToTask(r: Record<string, unknown>): Task {
    return {
      id: r['id'] as string, missionId: r['mission_id'] as string,
      repoId: r['repo_id'] as string, title: r['title'] as string,
      prompt: r['prompt'] as string, status: r['status'] as Task['status'],
      attemptNumber: r['attempt_number'] as number,
      parentTaskId: r['parent_task_id'] as string | undefined,
      createdAt: r['created_at'] as string, updatedAt: r['updated_at'] as string,
    }
  }

  // --- Runs ---
  insertRun(r: Omit<Run, 'id' | 'createdAt'>): Run {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO runs (id,task_id,runner_mode,status,started_at,completed_at,exit_code,evidence_dir,error_message,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
      id, r.taskId, r.runnerMode, r.status, r.startedAt ?? null, r.completedAt ?? null,
      r.exitCode ?? null, r.evidenceDir ?? null, r.errorMessage ?? null, now
    )
    return { ...r, id, createdAt: now }
  }

  updateRun(id: string, updates: Partial<Pick<Run, 'status' | 'completedAt' | 'exitCode' | 'evidenceDir' | 'errorMessage' | 'startedAt'>>): void {
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(updates)) {
      const col = k.replace(/([A-Z])/g, '_$1').toLowerCase()
      sets.push(`${col} = ?`); vals.push(v ?? null)
    }
    vals.push(id)
    this.db.prepare(`UPDATE runs SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }

  getRun(id: string): Run | undefined {
    const row = this.db.prepare('SELECT * FROM runs WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToRun(row) : undefined
  }

  private rowToRun(r: Record<string, unknown>): Run {
    return {
      id: r['id'] as string, taskId: r['task_id'] as string,
      runnerMode: r['runner_mode'] as RunnerMode, status: r['status'] as Run['status'],
      startedAt: r['started_at'] as string | undefined, completedAt: r['completed_at'] as string | undefined,
      exitCode: r['exit_code'] as number | undefined, evidenceDir: r['evidence_dir'] as string | undefined,
      errorMessage: r['error_message'] as string | undefined, createdAt: r['created_at'] as string,
    }
  }

  // --- Approvals ---
  insertApproval(a: Omit<Approval, 'id' | 'createdAt'>): Approval {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO approvals (id,entity_type,entity_id,required_reason,status,decided_by,decided_at,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, a.entityType, a.entityId, a.requiredReason, a.status,
      a.decidedBy ?? null, a.decidedAt ?? null, a.notes ?? null, now
    )
    return { ...a, id, createdAt: now }
  }

  updateApproval(id: string, updates: Partial<Pick<Approval, 'status' | 'decidedBy' | 'decidedAt' | 'notes'>>): void {
    const sets: string[] = []
    const vals: unknown[] = []
    for (const [k, v] of Object.entries(updates)) {
      const col = k.replace(/([A-Z])/g, '_$1').toLowerCase()
      sets.push(`${col} = ?`); vals.push(v ?? null)
    }
    vals.push(id)
    this.db.prepare(`UPDATE approvals SET ${sets.join(', ')} WHERE id = ?`).run(...vals)
  }

  listApprovals(status?: string): Approval[] {
    const rows = status
      ? this.db.prepare('SELECT * FROM approvals WHERE status = ?').all(status) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM approvals').all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToApproval(r))
  }

  private rowToApproval(r: Record<string, unknown>): Approval {
    return {
      id: r['id'] as string, entityType: r['entity_type'] as string,
      entityId: r['entity_id'] as string, requiredReason: r['required_reason'] as string,
      status: r['status'] as Approval['status'],
      decidedBy: r['decided_by'] as string | undefined, decidedAt: r['decided_at'] as string | undefined,
      notes: r['notes'] as string | undefined, createdAt: r['created_at'] as string,
    }
  }

  // --- Validator results ---
  insertValidatorResult(v: Omit<ValidatorResult, 'id' | 'createdAt'>): ValidatorResult {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO validator_results (id,task_id,run_id,validator,verdict,summary,evidence_bundle_path,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
      id, v.taskId, v.runId, v.validator, v.verdict, v.summary ?? null, v.evidenceBundlePath ?? null, now
    )
    return { ...v, id, createdAt: now }
  }

  listValidatorResults(taskId: string): ValidatorResult[] {
    const rows = this.db.prepare('SELECT * FROM validator_results WHERE task_id = ?').all(taskId) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r['id'] as string, taskId: r['task_id'] as string, runId: r['run_id'] as string,
      validator: r['validator'] as ValidatorName, verdict: r['verdict'] as ValidatorVerdict,
      summary: r['summary'] as string | undefined,
      evidenceBundlePath: r['evidence_bundle_path'] as string | undefined,
      createdAt: r['created_at'] as string,
    }))
  }

  // --- Risk scores ---
  insertRiskScore(s: Omit<RiskScore, 'id'>): RiskScore {
    const id = generateId()
    this.db.prepare(`INSERT INTO risk_scores (id,task_id,run_id,score,level,factors,computed_at) VALUES (?,?,?,?,?,?,?)`).run(
      id, s.taskId, s.runId ?? null, s.score, s.level, JSON.stringify(s.factors), s.computedAt
    )
    return { ...s, id }
  }

  // --- Memory items ---
  insertMemoryItem(item: Omit<MemoryItem, 'id' | 'createdAt'>): MemoryItem {
    const secretPattern = /PASSWORD\s*=|TOKEN\s*=|SECRET\s*=|API_KEY\s*=/i
    if (secretPattern.test(item.content)) {
      throw new Error('Memory content appears to contain secrets (PASSWORD=, TOKEN=, SECRET=, API_KEY=). Sanitize before storing.')
    }
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO memory_items (id,type,title,content,source_task_id,source_mission_id,repo_id,approved,created_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, item.type, item.title, item.content,
      item.sourceTaskId ?? null, item.sourceMissionId ?? null, item.repoId ?? null,
      item.approved ? 1 : 0, now
    )
    return { ...item, id, createdAt: now }
  }

  approveMemoryItem(id: string): void {
    this.db.prepare('UPDATE memory_items SET approved = 1 WHERE id = ?').run(id)
  }

  listMemoryItems(filters: { approved?: boolean; repoId?: string } = {}): MemoryItem[] {
    let sql = 'SELECT * FROM memory_items WHERE 1=1'
    const params: unknown[] = []
    if (filters.approved !== undefined) { sql += ' AND approved = ?'; params.push(filters.approved ? 1 : 0) }
    if (filters.repoId) { sql += ' AND repo_id = ?'; params.push(filters.repoId) }
    sql += ' ORDER BY created_at DESC'
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r['id'] as string, type: r['type'] as string, title: r['title'] as string,
      content: r['content'] as string,
      sourceTaskId: r['source_task_id'] as string | undefined,
      sourceMissionId: r['source_mission_id'] as string | undefined,
      repoId: r['repo_id'] as string | undefined,
      approved: r['approved'] === 1,
      createdAt: r['created_at'] as string,
    }))
  }

  // --- Events ---
  insertEvent(type: string, entityType?: string, entityId?: string, payload: Record<string, unknown> = {}): Event {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO events (id,type,entity_type,entity_id,payload,created_at) VALUES (?,?,?,?,?,?)`).run(
      id, type, entityType ?? null, entityId ?? null, JSON.stringify(payload), now
    )
    return { id, type, entityType, entityId, payload, createdAt: now }
  }

  queryEvents(filters: { type?: string; entityId?: string; limit?: number } = {}): Event[] {
    let sql = 'SELECT * FROM events WHERE 1=1'
    const params: unknown[] = []
    if (filters.type) { sql += ' AND type = ?'; params.push(filters.type) }
    if (filters.entityId) { sql += ' AND entity_id = ?'; params.push(filters.entityId) }
    sql += ' ORDER BY created_at DESC'
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit) }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r['id'] as string, type: r['type'] as string,
      entityType: r['entity_type'] as string | undefined,
      entityId: r['entity_id'] as string | undefined,
      payload: JSON.parse(r['payload'] as string) as Record<string, unknown>,
      createdAt: r['created_at'] as string,
    }))
  }
}

// re-export type aliases used by other packages
export type { RiskLevel, RunnerMode, ValidatorName, ValidatorVerdict }
