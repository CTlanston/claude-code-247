export const DAEMON = typeof window !== 'undefined' ? '/api' : 'http://localhost:7247'

export interface ApiMission {
  id: string; title: string; status: string; description?: string
  githubPrUrl?: string; githubPrNumber?: number; createdAt: string
}
export interface ApiRepo {
  id: string; name: string; path: string; enabled: boolean
}
export interface ApiTaskRun {
  id: string; runnerMode: string; status: string; exitCode: number | null; evidenceDir: string | null
}
export interface ApiTask {
  id: string; title: string; status: string; missionId: string; createdAt: string
  missionTitle?: string | null; missionStatus?: string | null
  repoName?: string | null; repoPath?: string | null
  runCount?: number; latestRun?: ApiTaskRun | null
}
export interface ApiOperatorSession {
  id: string; repoId?: string; missionId?: string; title: string; prompt: string; status: string
  createdAt: string; updatedAt: string
}
export interface ApiOperatorChoice {
  id: string
  label: string
  labelEn: string
  action: 'generate-roadmap' | 'ask-questions' | 'add-constraints'
  prompt?: string
}
export interface ApiOperatorQuestionOption {
  label: string; labelEn?: string; value?: string; recommended?: boolean
}
export interface ApiOperatorQuestion {
  id: string; field: string; question: string; options: ApiOperatorQuestionOption[]; answer?: string
}
export interface ApiOperatorMessageMeta {
  provider?: string; authMode?: string; agentMode?: 'single' | 'multi'
  inputTokens?: number; outputTokens?: number; costUsd?: number | null
}
export interface ApiOperatorMessage {
  id: string; sessionId: string; role: 'user' | 'assistant' | 'system'; content: string
  choices?: ApiOperatorChoice[]; questions?: ApiOperatorQuestion[]; meta?: ApiOperatorMessageMeta; createdAt: string
}
export interface ApiHold {
  id: string; entityType: string; entityId: string; code: string; reason: string
  nextAction?: string; status: 'active' | 'resolved'; createdAt: string; resolvedAt?: string
}
export interface ApiRunProgress {
  runId: string; status: string; exitCode: number | null
  startedAt: string | null; lastHeartbeatAt: string | null
  elapsedMs: number | null; sinceHeartbeatMs: number | null
  stalled: boolean; lastProgressLabel: string
}
export interface ApiEvent {
  id: string; type: string; entityType?: string; entityId?: string; payload: Record<string, unknown>; createdAt: string
}
export interface ApiMissionArtifact {
  id: string; missionId: string; type: string; path: string; title?: string; preview?: string | null; updatedAt: string
}
export interface ApiValidatorResult {
  id: string; validator: string; verdict: string; summary?: string; createdAt: string
}
export interface ApiRun {
  id: string; taskId: string; runnerMode: string; status: string; evidenceDir?: string; exitCode?: number
}
export interface ApiMissionOverview {
  mission: ApiMission
  stage: string
  stages: Array<{ stage: string; status: string }>
  tasks: ApiTask[]
  runs: ApiRun[]
  validators: ApiValidatorResult[]
  artifacts: ApiMissionArtifact[]
  approvals: ApiApproval[]
  activeAgents: string[]
  cliProvider: string
  progress: number
  holds: Array<{ type: string; payload: Record<string, unknown> }>
  activeHolds?: ApiHold[]
  runProgress?: ApiRunProgress | null
  events: ApiEvent[]
  evidenceDir?: string
  validatorStatus?: string
  validatorNote?: string | null
  cost: {
    mode: string
    scope?: string
    runCount: number
    validatorCount: number
    plannerTokens?: number | null
    workerTokens?: number | null
    totalTokens?: number | null
    inputTokens: number | null
    outputTokens: number | null
    costUsd: number | null
    note: string
  }
}
export interface ApiApproval {
  id: string; entityType: string; entityId: string; requiredReason: string
  status: string; createdAt: string; decidedBy?: string; decidedAt?: string; notes?: string
  ageMs?: number
  mission?: { id: string; title: string; status: string; repoId: string }
  repo?: { id: string; name: string; path: string; enabled: boolean }
  sessionId?: string
  planPreviewTitle?: string
}
export interface ApiMemoryItem {
  id: string; type: string; title: string; content: string; approved: number; createdAt: string
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${DAEMON}${path}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json() as Promise<T>
}
async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${DAEMON}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${path}`)
  return res.json() as Promise<T>
}

export const api = {
  getStatus: () => get<{ status: string; missionOs: { autonomy: string; workerConcurrency: { min: number; max: number } } }>('/status'),
  getRepos: () => get<{ repos: ApiRepo[] }>('/repos').then((r) => r.repos),
  getMissions: () => get<{ missions: ApiMission[] }>('/missions').then((r) => r.missions),
  getTasks: (missionId?: string) => get<{ tasks: ApiTask[] }>(`/tasks${missionId ? `?missionId=${encodeURIComponent(missionId)}` : ''}`).then((r) => r.tasks),
  getApprovals: () => get<{ approvals: ApiApproval[] }>('/approvals').then((r) => r.approvals),
  decideApproval: (id: string, decision: 'approve' | 'reject' | 'request-changes', notes?: string) =>
    post<{ status: string; decision: string; approval?: ApiApproval; approvals: ApiApproval[] }>(`/approvals/${id}/decision`, { decision, ...(notes ? { notes } : {}) }),
  getMemory: () => get<{ items: ApiMemoryItem[] }>('/memory').then((r) => r.items),
  approveMission: (id: string) => post(`/missions/${id}/approve`, {}),
  pauseMission: (id: string) => post(`/missions/${id}/status`, { status: 'paused' }),
  resumeMission: (id: string) => post(`/missions/${id}/status`, { status: 'running' }),
  cancelMission: (id: string) => post(`/missions/${id}/status`, { status: 'cancelled' }),
  approveMemory: (id: string) => post(`/memory/${id}/approve`, {}),
  createOperatorSession: (body: { repoId?: string; title?: string; prompt: string }) =>
    post<{ session: ApiOperatorSession; messages: ApiOperatorMessage[] }>('/operator/sessions', body),
  getLatestOperatorSession: () =>
    get<{ session: ApiOperatorSession | null; messages: ApiOperatorMessage[] }>('/operator/sessions?latest=1'),
  listOperatorSessions: () =>
    get<{ sessions: ApiOperatorSession[] }>('/operator/sessions').then((r) => r.sessions),
  getOperatorSession: (id: string) =>
    get<{ session: ApiOperatorSession; messages: ApiOperatorMessage[] }>(`/operator/sessions/${id}`),
  addOperatorMessage: (id: string, content: string) =>
    post<{ message: ApiOperatorMessage; messages: ApiOperatorMessage[] }>(`/operator/sessions/${id}/messages`, { content }),
  askQuestions: (id: string, prompt?: string) =>
    post<{ session: ApiOperatorSession; messages: ApiOperatorMessage[] }>(`/operator/sessions/${id}/ask`, { prompt }),
  answerQuestions: (id: string, answers: { questionId: string; value: string }[]) =>
    post<{ session: ApiOperatorSession; messages: ApiOperatorMessage[] }>(`/operator/sessions/${id}/answer-questions`, { answers }),
  generateRoadmap: (id: string) =>
    post<{ session: ApiOperatorSession; mission?: ApiMission; artifacts?: ApiMissionArtifact[]; messages: ApiOperatorMessage[]; hold?: { code: string; reason: string } }>(`/operator/sessions/${id}/generate-roadmap`, {}),
  approveRoadmap: (id: string) =>
    post<{ session: ApiOperatorSession; mission: ApiMission; overview: ApiMissionOverview }>(`/operator/sessions/${id}/approve-roadmap`, {}),
  startOperatorSession: (id: string) =>
    post<{ session: ApiOperatorSession; result: { status: string; mergeDecision: string }; overview: ApiMissionOverview; hold?: { code: string; reason: string } }>(`/operator/sessions/${id}/start`, {}),
  pauseOperatorSession: (id: string) =>
    post<{ session: ApiOperatorSession; overview: ApiMissionOverview }>(`/operator/sessions/${id}/pause`, {}),
  stopOperatorSession: (id: string) =>
    post<{ session: ApiOperatorSession; overview: ApiMissionOverview }>(`/operator/sessions/${id}/stop`, {}),
  resumeOperatorSession: (id: string) =>
    post<{ session: ApiOperatorSession; overview: ApiMissionOverview }>(`/operator/sessions/${id}/resume`, {}),
  createDraftPr: (id: string) =>
    post<{ status: string; code?: string; reason?: string; pr?: { url: string; number: number }; overview: ApiMissionOverview }>(`/operator/sessions/${id}/create-pr`, {}),
  getMissionOverview: (id: string) => get<ApiMissionOverview>(`/missions/${id}/overview`),
  getRunLog: (missionId: string, runId: string) => get<{ text: string; logPath: string }>(`/missions/${missionId}/runs/${runId}/log`),
}
