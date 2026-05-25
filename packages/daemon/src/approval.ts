import type { AedevDb, Approval } from '@aedev/core'
import { nowIso } from '@aedev/core'

export class ApprovalGate {
  constructor(private db: AedevDb) {}

  requireApproval(entityType: string, entityId: string, reason: string): Approval {
    const approval = this.db.insertApproval({
      entityType, entityId, requiredReason: reason, status: 'pending',
    })
    this.db.insertEvent('approval.created', 'approval', approval.id, { entityType, entityId, reason })
    return approval
  }

  approve(approvalId: string, by: string, notes?: string): Approval {
    this.db.updateApproval(approvalId, { status: 'approved', decidedBy: by, decidedAt: nowIso(), notes })
    const approvals = this.db.listApprovals()
    const approval = approvals.find((a) => a.id === approvalId)
    if (!approval) throw new Error(`Approval ${approvalId} not found`)
    this.db.insertEvent('approval.decided', 'approval', approvalId, { verdict: 'approved', by })
    return approval
  }

  reject(approvalId: string, by: string, notes?: string): Approval {
    this.db.updateApproval(approvalId, { status: 'rejected', decidedBy: by, decidedAt: nowIso(), notes })
    const approvals = this.db.listApprovals()
    const approval = approvals.find((a) => a.id === approvalId)
    if (!approval) throw new Error(`Approval ${approvalId} not found`)
    this.db.insertEvent('approval.decided', 'approval', approvalId, { verdict: 'rejected', by })
    return approval
  }

  getPendingApprovals(): Approval[] {
    return this.db.listApprovals('pending')
  }
}
