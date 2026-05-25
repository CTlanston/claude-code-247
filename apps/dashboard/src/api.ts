export const DAEMON = typeof window !== 'undefined' ? '/api' : 'http://localhost:7247'

export interface ApiMission {
  id: string; title: string; status: string; description?: string
  githubPrUrl?: string; githubPrNumber?: number; createdAt: string
}
export interface ApiTask {
  id: string; title: string; status: string; missionId: string; createdAt: string
}
export interface ApiApproval {
  id: string; entityType: string; entityId: string; requiredReason: string
  status: string; createdAt: string
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
  getMissions: () => get<{ missions: ApiMission[] }>('/missions').then((r) => r.missions),
  getTasks: () => get<{ tasks: ApiTask[] }>('/tasks').then((r) => r.tasks),
  getApprovals: () => get<{ approvals: ApiApproval[] }>('/approvals').then((r) => r.approvals),
  getMemory: () => get<{ items: ApiMemoryItem[] }>('/memory').then((r) => r.items),
  approveMission: (id: string) => post(`/missions/${id}/approve`, {}),
  pauseMission: (id: string) => post(`/missions/${id}/status`, { status: 'paused' }),
  resumeMission: (id: string) => post(`/missions/${id}/status`, { status: 'running' }),
  cancelMission: (id: string) => post(`/missions/${id}/status`, { status: 'cancelled' }),
  approveMemory: (id: string) => post(`/memory/${id}/approve`, {}),
}
