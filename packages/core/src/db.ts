import Database from 'better-sqlite3'
import { runMigrations } from './migrations.js'
import { generateId, nowIso } from './ids.js'
import type {
  Repo, Mission, Task, Run, Approval, Event, RiskScore, ValidatorResult, MemoryItem,
  OperatorSession, OperatorMessage, MissionArtifact, ModelUsage, Hold, HoldStatus,
  FleetWorker, FleetWorkerStatus,
} from './schema.js'
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

  listRuns(taskId?: string): Run[] {
    const rows = taskId
      ? this.db.prepare('SELECT * FROM runs WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM runs ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToRun(r))
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

  // --- Operator cockpit ---
  insertOperatorSession(s: Omit<OperatorSession, 'id' | 'createdAt' | 'updatedAt'>): OperatorSession {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO operator_sessions (id,repo_id,mission_id,title,prompt,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?)`).run(
      id, s.repoId ?? null, s.missionId ?? null, s.title, s.prompt, s.status, now, now
    )
    return { ...s, id, createdAt: now, updatedAt: now }
  }

  updateOperatorSession(id: string, updates: Partial<Pick<OperatorSession, 'missionId' | 'status' | 'title'>>): void {
    const sets: string[] = []
    const vals: unknown[] = []
    if (updates.missionId !== undefined) { sets.push('mission_id = ?'); vals.push(updates.missionId) }
    if (updates.status !== undefined) { sets.push('status = ?'); vals.push(updates.status) }
    if (updates.title !== undefined) { sets.push('title = ?'); vals.push(updates.title) }
    if (sets.length === 0) return
    vals.push(nowIso(), id)
    this.db.prepare(`UPDATE operator_sessions SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...vals)
  }

  getOperatorSession(id: string): OperatorSession | undefined {
    const row = this.db.prepare('SELECT * FROM operator_sessions WHERE id = ?').get(id) as Record<string, unknown> | undefined
    return row ? this.rowToOperatorSession(row) : undefined
  }

  listOperatorSessions(): OperatorSession[] {
    const rows = this.db.prepare('SELECT * FROM operator_sessions ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToOperatorSession(r))
  }

  insertOperatorMessage(m: Omit<OperatorMessage, 'id' | 'createdAt'>): OperatorMessage {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO operator_messages (id,session_id,role,content,choices,questions,meta,created_at) VALUES (?,?,?,?,?,?,?,?)`).run(
      id, m.sessionId, m.role, m.content,
      m.choices ? JSON.stringify(m.choices) : null,
      m.questions ? JSON.stringify(m.questions) : null,
      m.meta ? JSON.stringify(m.meta) : null,
      now
    )
    return { ...m, id, createdAt: now }
  }

  listOperatorMessages(sessionId: string): OperatorMessage[] {
    const rows = this.db.prepare('SELECT * FROM operator_messages WHERE session_id = ? ORDER BY created_at ASC').all(sessionId) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r['id'] as string,
      sessionId: r['session_id'] as string,
      role: r['role'] as OperatorMessage['role'],
      content: r['content'] as string,
      ...(r['choices'] ? { choices: JSON.parse(r['choices'] as string) as OperatorMessage['choices'] } : {}),
      ...(r['questions'] ? { questions: JSON.parse(r['questions'] as string) as OperatorMessage['questions'] } : {}),
      ...(r['meta'] ? { meta: JSON.parse(r['meta'] as string) as OperatorMessage['meta'] } : {}),
      createdAt: r['created_at'] as string,
    }))
  }

  // --- Holds (active-vs-historical, PRD §D) ---
  insertHold(h: Omit<Hold, 'id' | 'status' | 'createdAt' | 'resolvedAt'> & { status?: HoldStatus }): Hold {
    const id = generateId(); const now = nowIso()
    const status: HoldStatus = h.status ?? 'active'
    this.db.prepare(`INSERT INTO holds (id,entity_type,entity_id,code,reason,next_action,status,created_at,resolved_at) VALUES (?,?,?,?,?,?,?,?,?)`).run(
      id, h.entityType, h.entityId, h.code, h.reason, h.nextAction ?? null, status, now, null
    )
    return { id, entityType: h.entityType, entityId: h.entityId, code: h.code, reason: h.reason, ...(h.nextAction ? { nextAction: h.nextAction } : {}), status, createdAt: now }
  }

  /** Resolve active holds for an entity (optionally a specific code). Returns count resolved. */
  resolveHold(entityId: string, code?: string): number {
    const now = nowIso()
    const res = code
      ? this.db.prepare(`UPDATE holds SET status='resolved', resolved_at=? WHERE entity_id=? AND code=? AND status='active'`).run(now, entityId, code)
      : this.db.prepare(`UPDATE holds SET status='resolved', resolved_at=? WHERE entity_id=? AND status='active'`).run(now, entityId)
    return res.changes
  }

  listActiveHolds(entityId?: string): Hold[] {
    const rows = entityId
      ? this.db.prepare(`SELECT * FROM holds WHERE entity_id=? AND status='active' ORDER BY created_at DESC`).all(entityId) as Record<string, unknown>[]
      : this.db.prepare(`SELECT * FROM holds WHERE status='active' ORDER BY created_at DESC`).all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToHold(r))
  }

  listHolds(entityId: string): Hold[] {
    const rows = this.db.prepare(`SELECT * FROM holds WHERE entity_id=? ORDER BY created_at DESC`).all(entityId) as Record<string, unknown>[]
    return rows.map((r) => this.rowToHold(r))
  }

  private rowToHold(r: Record<string, unknown>): Hold {
    return {
      id: r['id'] as string,
      entityType: r['entity_type'] as string,
      entityId: r['entity_id'] as string,
      code: r['code'] as string,
      reason: r['reason'] as string,
      ...(r['next_action'] ? { nextAction: r['next_action'] as string } : {}),
      status: r['status'] as HoldStatus,
      createdAt: r['created_at'] as string,
      ...(r['resolved_at'] ? { resolvedAt: r['resolved_at'] as string } : {}),
    }
  }

  upsertMissionArtifact(a: Omit<MissionArtifact, 'id' | 'createdAt' | 'updatedAt'>): MissionArtifact {
    const existing = this.db.prepare('SELECT * FROM mission_artifacts WHERE mission_id = ? AND type = ? AND path = ?').get(
      a.missionId, a.type, a.path,
    ) as Record<string, unknown> | undefined
    const now = nowIso()
    if (existing) {
      this.db.prepare('UPDATE mission_artifacts SET title = ?, updated_at = ? WHERE id = ?').run(a.title ?? null, now, existing['id'])
      return this.rowToMissionArtifact({ ...existing, title: a.title ?? null, updated_at: now })
    }
    const id = generateId()
    this.db.prepare(`INSERT INTO mission_artifacts (id,mission_id,type,path,title,created_at,updated_at) VALUES (?,?,?,?,?,?,?)`).run(
      id, a.missionId, a.type, a.path, a.title ?? null, now, now
    )
    return { ...a, id, createdAt: now, updatedAt: now }
  }

  listMissionArtifacts(missionId: string): MissionArtifact[] {
    const rows = this.db.prepare('SELECT * FROM mission_artifacts WHERE mission_id = ? ORDER BY updated_at DESC').all(missionId) as Record<string, unknown>[]
    return rows.map((r) => this.rowToMissionArtifact(r))
  }

  private rowToOperatorSession(r: Record<string, unknown>): OperatorSession {
    return {
      id: r['id'] as string,
      repoId: r['repo_id'] as string | undefined,
      missionId: r['mission_id'] as string | undefined,
      title: r['title'] as string,
      prompt: r['prompt'] as string,
      status: r['status'] as string,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    }
  }

  private rowToMissionArtifact(r: Record<string, unknown>): MissionArtifact {
    return {
      id: r['id'] as string,
      missionId: r['mission_id'] as string,
      type: r['type'] as MissionArtifact['type'],
      path: r['path'] as string,
      title: r['title'] as string | undefined,
      createdAt: r['created_at'] as string,
      updatedAt: r['updated_at'] as string,
    }
  }

  // --- Model usage ---
  insertModelUsage(u: Omit<ModelUsage, 'id' | 'createdAt'>): ModelUsage {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO model_usage (id,task_id,run_id,auth_mode,model,provider,input_tokens,output_tokens,cost_usd,notes,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      id, u.taskId ?? null, u.runId ?? null, u.authMode, u.model ?? null, u.provider ?? null,
      u.inputTokens ?? null, u.outputTokens ?? null, u.costUsd ?? null, u.notes ?? null, now
    )
    return { ...u, id, createdAt: now }
  }

  listModelUsage(taskId?: string): ModelUsage[] {
    const rows = taskId
      ? this.db.prepare('SELECT * FROM model_usage WHERE task_id = ? ORDER BY created_at DESC').all(taskId) as Record<string, unknown>[]
      : this.db.prepare('SELECT * FROM model_usage ORDER BY created_at DESC').all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToModelUsage(r))
  }

  private rowToModelUsage(r: Record<string, unknown>): ModelUsage {
    return {
      id: r['id'] as string,
      taskId: r['task_id'] as string | undefined,
      runId: r['run_id'] as string | undefined,
      authMode: r['auth_mode'] as string,
      model: r['model'] as string | undefined,
      provider: r['provider'] as string | undefined,
      inputTokens: r['input_tokens'] as number | undefined,
      outputTokens: r['output_tokens'] as number | undefined,
      costUsd: r['cost_usd'] as number | undefined,
      notes: r['notes'] as string | undefined,
      createdAt: r['created_at'] as string,
    }
  }

  // --- Fleet workers (v5-P2, ADR-0022/0023) ---
  /** Register a BYO worker by public-key identity. Never stores credentials. */
  insertFleetWorker(w: { workerId: string; operatorId: string; publicKey: string }): FleetWorker {
    const now = nowIso()
    this.db.prepare(`INSERT INTO fleet_workers (worker_id,operator_id,public_key,status,last_seen_at,registered_at) VALUES (?,?,?,?,?,?)`).run(
      w.workerId, w.operatorId, w.publicKey, 'active', null, now
    )
    return { workerId: w.workerId, operatorId: w.operatorId, publicKey: w.publicKey, status: 'active', registeredAt: now }
  }

  getFleetWorker(workerId: string): FleetWorker | undefined {
    const row = this.db.prepare('SELECT * FROM fleet_workers WHERE worker_id = ?').get(workerId) as Record<string, unknown> | undefined
    return row ? this.rowToFleetWorker(row) : undefined
  }

  listFleetWorkers(): FleetWorker[] {
    const rows = this.db.prepare('SELECT * FROM fleet_workers ORDER BY registered_at ASC').all() as Record<string, unknown>[]
    return rows.map((r) => this.rowToFleetWorker(r))
  }

  /** Liveness ledger: heartbeats and claims both touch last_seen_at. */
  touchFleetWorker(workerId: string, lastSeenAt: string): void {
    this.db.prepare('UPDATE fleet_workers SET last_seen_at = ? WHERE worker_id = ?').run(lastSeenAt, workerId)
  }

  setFleetWorkerStatus(workerId: string, status: FleetWorkerStatus): void {
    this.db.prepare('UPDATE fleet_workers SET status = ? WHERE worker_id = ?').run(status, workerId)
  }

  /** First-write-wins replay guard. Returns false when (workerId, nonce) was already used. */
  recordFleetNonce(workerId: string, nonce: string, endpoint: string): boolean {
    const res = this.db.prepare('INSERT OR IGNORE INTO fleet_nonces (worker_id,nonce,endpoint,response_json,created_at) VALUES (?,?,?,NULL,?)').run(
      workerId, nonce, endpoint, nowIso()
    )
    return res.changes > 0
  }

  getFleetNonce(workerId: string, nonce: string): { endpoint: string; responseJson?: string } | undefined {
    const row = this.db.prepare('SELECT endpoint, response_json FROM fleet_nonces WHERE worker_id = ? AND nonce = ?').get(workerId, nonce) as
      { endpoint: string; response_json: string | null } | undefined
    if (!row) return undefined
    return { endpoint: row.endpoint, ...(row.response_json !== null ? { responseJson: row.response_json } : {}) }
  }

  /** Cache the response for an idempotent endpoint (claim) so replays return the same answer. */
  saveFleetNonceResponse(workerId: string, nonce: string, responseJson: string): void {
    this.db.prepare('UPDATE fleet_nonces SET response_json = ? WHERE worker_id = ? AND nonce = ?').run(responseJson, workerId, nonce)
  }

  private rowToFleetWorker(r: Record<string, unknown>): FleetWorker {
    return {
      workerId: r['worker_id'] as string,
      operatorId: r['operator_id'] as string,
      publicKey: r['public_key'] as string,
      status: r['status'] as FleetWorkerStatus,
      ...(r['last_seen_at'] ? { lastSeenAt: r['last_seen_at'] as string } : {}),
      registeredAt: r['registered_at'] as string,
    }
  }

  // --- Events ---
  /** v5-P1: every new event carries an operator identity (default 'owner'). */
  insertEvent(type: string, entityType?: string, entityId?: string, payload: Record<string, unknown> = {}, operatorId: string = 'owner'): Event {
    const id = generateId(); const now = nowIso()
    this.db.prepare(`INSERT INTO events (id,type,entity_type,entity_id,payload,created_at,operator_id) VALUES (?,?,?,?,?,?,?)`).run(
      id, type, entityType ?? null, entityId ?? null, JSON.stringify(payload), now, operatorId
    )
    return { id, type, entityType, entityId, payload, createdAt: now, operatorId }
  }

  queryEvents(filters: { type?: string; entityId?: string; operatorId?: string; limit?: number } = {}): Event[] {
    let sql = 'SELECT * FROM events WHERE 1=1'
    const params: unknown[] = []
    if (filters.type) { sql += ' AND type = ?'; params.push(filters.type) }
    if (filters.entityId) { sql += ' AND entity_id = ?'; params.push(filters.entityId) }
    // ADR-0023 backfill rule: pre-v5 rows (NULL operator_id) belong to 'owner'.
    if (filters.operatorId) { sql += " AND COALESCE(operator_id, 'owner') = ?"; params.push(filters.operatorId) }
    sql += ' ORDER BY created_at DESC'
    if (filters.limit) { sql += ' LIMIT ?'; params.push(filters.limit) }
    const rows = this.db.prepare(sql).all(...params) as Record<string, unknown>[]
    return rows.map((r) => ({
      id: r['id'] as string, type: r['type'] as string,
      entityType: r['entity_type'] as string | undefined,
      entityId: r['entity_id'] as string | undefined,
      payload: JSON.parse(r['payload'] as string) as Record<string, unknown>,
      createdAt: r['created_at'] as string,
      operatorId: (r['operator_id'] as string | null) ?? 'owner',
    }))
  }
}

// re-export type aliases used by other packages
export type { RiskLevel, RunnerMode, ValidatorName, ValidatorVerdict }
