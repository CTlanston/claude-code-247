export const DAEMON = typeof window !== 'undefined' ? '/api' : 'http://localhost:7247'

/**
 * cloudhull-c5 — trusted-local display name (one shared Mac, Tailscale LAN).
 * Persisted in localStorage and sent as the plain `x-aedev-user` header on
 * every call. This is attribution for a trusted LAN, explicitly NOT auth.
 */
export const USER_NAME_STORAGE_KEY = 'aedevUserName'

export function getStoredUserName(): string {
  try {
    return (typeof localStorage !== 'undefined' && localStorage.getItem(USER_NAME_STORAGE_KEY)?.trim()) || ''
  } catch {
    return ''
  }
}

export function setStoredUserName(name: string): void {
  try {
    if (typeof localStorage === 'undefined') return
    if (name.trim()) localStorage.setItem(USER_NAME_STORAGE_KEY, name.trim())
    else localStorage.removeItem(USER_NAME_STORAGE_KEY)
  } catch {
    // storage unavailable — the header is simply omitted
  }
}

function userHeader(): Record<string, string> {
  const name = getStoredUserName()
  return name ? { 'x-aedev-user': name } : {}
}

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
  /** cloudhull-c5 — submitting user's display name ('owner' when unset). */
  submittedBy?: string
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
  id: string; field: string; question: string
  why?: string; impact?: string; destination?: string
  options: ApiOperatorQuestionOption[]; answer?: string
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
export type ApiOperatorMissionStage =
  | 'intake'
  | 'new'
  | 'understanding'
  | 'understanding_ready'
  | 'brainstorming'
  | 'clarifying'
  | 'roadmap_ready'
  | 'pending_approval'
  | 'approved'
  | 'running'
  | 'evidence_ready'
  | 'validating'
  | 'validators_ready'
  | 'validators_missing'
  | 'pr_blocked'
  | 'pr_ready'
  | 'pr_created'
  | 'learned'
  | 'failed'
  | 'cancelled'
export interface ApiProviderMode {
  name: string
  mode: 'subscription-local' | 'validator-api-only' | 'paid-api-fallback' | 'mock' | 'not_configured' | 'unknown'
  status?: string
  tokens?: number | null
  costUsd?: number | null
}
export interface ApiOperatorActionView {
  id: 'start-brainstorm' | 'generate-plan' | 'approve-roadmap' | 'start-execution' | 'check-draft-pr-gate' | 'resume' | 'pause' | 'start-over'
  label: string
  kind: 'primary' | 'secondary'
  disabled?: boolean
}
/** v-ux-1 — non-developer state vocabulary mirrored from the daemon. */
export type ApiUserState =
  | 'understanding'
  | 'needs_more_context'
  | 'planning'
  | 'ready_to_execute'
  | 'executing'
  | 'testing'
  | 'evaluating'
  | 'blocked'
  | 'waiting_for_approval'
  | 'completed'
export interface ApiUserStateView {
  state: ApiUserState; label: string; labelZh: string; explanation: string
}
export interface ApiLastActivity {
  atIso: string | null; agoMs: number | null; phase: string
}
export interface ApiLoopSummary {
  whatChanged: string[]; testsRan: string[]; agents: string[]
  validatorSaid: string | null; whyStoppedOrContinuing: string
}
/** v6-P1 — five-card loop protocol, mirrored from packages/daemon/src/loop-cards.ts.
 *  Machine codes live ONLY in `machine`; visible text is calm + bilingual;
 *  every card answers "what happens next" via `next_step`. */
export interface ApiLoopCardMachine {
  user_state: string; stage: string; hold_code: string | null; pr_gate_code: string | null
}
export interface ApiUnderstandingLoopCard {
  type: 'understanding'; title: string; next_step: string; machine: ApiLoopCardMachine
  user_goal: string; interpreted_goal: string; out_of_scope: string[]
  confidence: number; questions: Array<{ id: string; question: string }>; default_assumptions: string[]
}
export interface ApiPlanLoopCard {
  type: 'plan'; title: string; next_step: string; machine: ApiLoopCardMachine
  objective: string; phases: string[]; acceptance_criteria: string[]
  risk_level: 'low' | 'medium' | 'high'; estimated_calls: number; requires_approval: boolean
}
export interface ApiProgressLoopCard {
  type: 'progress'; title: string; next_step: string; machine: ApiLoopCardMachine
  current_phase: string; current_action: string; evidence_links: string[]; tests_run: string[]
}
export interface ApiBlockerLoopCard {
  type: 'blocker'; title: string; next_step: string; machine: ApiLoopCardMachine
  human_explanation: string; why_it_matters: string
  recovery_actions: string[]; recommended_action: string
}
export interface ApiPrReadyLoopCard {
  type: 'pr_ready'; title: string; next_step: string; machine: ApiLoopCardMachine
  pr_url: string | null; summary: string; files_changed: string[]; tests: string[]
  validator_verdict: string | null; risk: 'low' | 'medium' | 'high'
  merge_policy: string; rework_button: { enabled: boolean; label: string }
}
export type ApiLoopCard =
  | ApiUnderstandingLoopCard
  | ApiPlanLoopCard
  | ApiProgressLoopCard
  | ApiBlockerLoopCard
  | ApiPrReadyLoopCard
export interface ApiOperatorMissionView {
  stage: ApiOperatorMissionStage
  stageLabel: string
  confidence: number
  progressPercent: number
  /** P1 — today's metered headless claude calls (Agent SDK credit). */
  headlessCallsToday?: number
  primaryAction?: ApiOperatorActionView
  secondaryActions: ApiOperatorActionView[]
  providerSummary: {
    planner?: ApiProviderMode
    worker?: ApiProviderMode
    validators: ApiProviderMode[]
  }
  safetySummary: {
    remoteWrites: 'enabled' | 'disabled'
    prGate?: { status: 'blocked' | 'ready' | 'created'; code?: string; reason?: string; remediation?: string }
    testMode?: { enabled: boolean; reason: string }
  }
  understanding: {
    roundsCompleted: number
    questions: ApiOperatorQuestion[]
    readyReason?: string
  }
  projectPulse: {
    progress: Array<{ id: string; label: string; status: 'done' | 'active' | 'pending' | 'blocked'; detail?: string }>
    workingFolder?: string
    touchedFiles: string[]
    evidence: Array<{ id: string; title: string; path: string; type: string }>
    validatorReviews: Array<{
      id: string
      validator: string
      verdict: string
      summary: string
      checkedEvidence: string[]
      blockingIssues: string[]
      evidenceGaps: string[]
      recommendedNextAction: string
    }>
  }
  memorySummary: {
    projectFacts: Array<{ id: string; kind: string; text: string; provenance: string; ttlDays: number; superseded: boolean }>
    userPreferences: Array<{ id: string; kind: string; text: string; provenance: string; ttlDays: number; superseded: boolean }>
    recentLessons: Array<{ id: string; kind: string; text: string; provenance: string; ttlDays: number; superseded: boolean }>
  }
  summary: string
  nextAction: string
  testMode: boolean
  /** v-ux-1 — optional so the dashboard stays compatible with an older daemon. */
  userState?: ApiUserStateView
  lastActivity?: ApiLastActivity
  loopSummary?: ApiLoopSummary
  /** v6-P1 — exactly one of the five ordinary-user cards (optional for older daemons). */
  card?: ApiLoopCard
}
export interface ApiMissionOverview {
  mission: ApiMission
  stage: string
  stages: Array<{ stage: string; status: string }>
  operatorView?: ApiOperatorMissionView
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
/** v5-P3 read-only fleet overview — no write actions, no key material. */
export interface ApiFleetWorker {
  workerId: string; operatorId: string; status: string; lastSeenAt: string | null; claimedTaskIds: string[]
}
export interface ApiFleetHold {
  code: string; entityType: string; entityId: string; reason: string; createdAt: string
}
export interface ApiFleetOperator {
  operatorId: string; headlessCallsToday: number; activeHolds: ApiFleetHold[]
}
export interface ApiFleetOverview {
  workers: ApiFleetWorker[]; operators: ApiFleetOperator[]
}

/**
 * v-ux-1 — HTTP failure that keeps the parsed response body, so the UI can
 * translate structured refusals (e.g. CLARIFY-gate 409 guidance) into human
 * wording instead of surfacing raw status codes.
 */
export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

async function throwApiError(res: Response, path: string): Promise<never> {
  const body = await res.json().catch(() => null)
  throw new ApiError(`HTTP ${res.status}: ${path}`, res.status, body)
}

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${DAEMON}${path}`, { headers: { ...userHeader() } })
  if (!res.ok) await throwApiError(res, path)
  return res.json() as Promise<T>
}
async function post<T>(path: string, body: unknown = {}): Promise<T> {
  const res = await fetch(`${DAEMON}${path}`, {
    method: 'POST', headers: { 'content-type': 'application/json', ...userHeader() }, body: JSON.stringify(body),
  })
  if (!res.ok) await throwApiError(res, path)
  return res.json() as Promise<T>
}

export const api = {
  getStatus: () => get<{ status: string; ownerName?: string; missionOs: { autonomy: string; workerConcurrency: { min: number; max: number } } }>('/status'),
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
  createOperatorSession: (body: { repoId?: string; title?: string; prompt: string; submittedBy?: string }) =>
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
  getFleetOverview: () => get<ApiFleetOverview>('/fleet/overview'),
  getRunLog: (missionId: string, runId: string) => get<{ text: string; logPath: string }>(`/missions/${missionId}/runs/${runId}/log`),
}
