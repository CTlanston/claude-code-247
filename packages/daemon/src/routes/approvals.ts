import type { FastifyInstance } from 'fastify'
import type { AedevDb, Approval } from '@aedev/core'
import { ApprovalGate } from '../approval.js'
import { IntakeService } from '../intake.js'
import { buildMissionOverview } from './operator.js'

/**
 * Approvals workbench (Operator Cockpit P1).  The list is enriched with the
 * mission title, repo, originating operator session, and age so the Approvals
 * page (and the cockpit counter) are an actionable workbench, not a bare id
 * list.  A decision endpoint lets the operator approve/reject from either the
 * Approvals page or the cockpit, sharing one source of truth.
 */

export interface ApprovalView extends Approval {
  ageMs: number
  mission?: { id: string; title: string; status: string; repoId: string }
  repo?: { id: string; name: string; path: string; enabled: boolean }
  sessionId?: string
  planPreviewTitle?: string
}

export function buildApprovalsView(db: AedevDb, now: number = Date.now()): ApprovalView[] {
  const sessions = db.listOperatorSessions()
  return db.listApprovals().map((a) => {
    const view: ApprovalView = { ...a, ageMs: Math.max(0, now - new Date(a.createdAt).getTime()) }
    if (a.entityType === 'mission') {
      const mission = db.getMission(a.entityId)
      if (mission) {
        view.mission = { id: mission.id, title: mission.title, status: mission.status, repoId: mission.repoId }
        view.planPreviewTitle = mission.title
        const repo = db.getRepo(mission.repoId)
        if (repo) view.repo = { id: repo.id, name: repo.name, path: repo.path, enabled: repo.enabled }
        const session = sessions.find((s) => s.missionId === mission.id)
        if (session) view.sessionId = session.id
      }
    }
    return view
  }).sort((a, b) => {
    // Pending first, then newest.
    if (a.status !== b.status) return a.status === 'pending' ? -1 : b.status === 'pending' ? 1 : 0
    return b.createdAt.localeCompare(a.createdAt)
  })
}

export function registerApprovalRoutes(app: FastifyInstance, db: AedevDb, stateDir: string): void {
  app.get('/approvals', async () => ({ approvals: buildApprovalsView(db) }))

  app.post<{ Params: { id: string }; Body: { decision?: 'approve' | 'reject' | 'request-changes'; by?: string; notes?: string } }>(
    '/approvals/:id/decision',
    async (req, reply) => {
      const approval = db.listApprovals().find((a) => a.id === req.params.id)
      if (!approval) return reply.code(404).send({ error: 'approval not found' })
      const decision = req.body.decision ?? 'approve'
      const by = req.body.by?.trim() || 'operator-cockpit'
      const gate = new ApprovalGate(db)
      try {
        if (decision === 'approve') {
          // Approving a mission's roadmap approval also transitions the mission so
          // it becomes startable — the same path the cockpit's approve-roadmap uses.
          if (approval.entityType === 'mission') {
            const mission = db.getMission(approval.entityId)
            if (mission && mission.status === 'pending_approval') {
              new IntakeService(db, stateDir).approveMission(mission.id, by)
            } else {
              gate.approve(approval.id, by, req.body.notes)
            }
          } else {
            gate.approve(approval.id, by, req.body.notes)
          }
        } else {
          // reject + request-changes both close the approval as rejected; the note
          // distinguishes intent for the operator.
          const notes = req.body.notes ?? (decision === 'request-changes' ? 'changes requested' : undefined)
          gate.reject(approval.id, by, notes)
        }
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message })
      }
      const updated = db.listApprovals().find((a) => a.id === req.params.id)
      const overview = approval.entityType === 'mission' ? buildMissionOverview(db, approval.entityId) : null
      return { status: 'ok', decision, approval: updated, approvals: buildApprovalsView(db), overview }
    },
  )
}
