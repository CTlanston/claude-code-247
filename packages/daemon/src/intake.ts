import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { AedevDb, Mission } from '@aedev/core'
import { validateMissionTransition } from '@aedev/core'
import { LeadAgent } from './lead-agent.js'
import { ApprovalGate } from './approval.js'

export class IntakeService {
  private agent: LeadAgent
  private gate: ApprovalGate

  constructor(
    private db: AedevDb,
    private stateDir: string,
  ) {
    this.agent = new LeadAgent(stateDir)
    this.gate = new ApprovalGate(db)
  }

  createMissionCandidate(repoId: string, description: string, title?: string): Mission {
    // Note: repoId may be 'unknown' if no repos registered yet
    const mission = this.db.insertMission({
      repoId, title: title ?? description.slice(0, 80),
      description, status: 'draft',
    })
    const prdDir = join(this.stateDir, 'prd')
    mkdirSync(prdDir, { recursive: true })
    const prdPath = join(prdDir, `${mission.id}.md`)
    const prdContent = this.agent.generatePrdTemplate(mission.id, description)
    writeFileSync(prdPath, prdContent)
    this.db.updateMissionStatus(mission.id, 'draft')
    this.db.insertEvent('mission.created', 'mission', mission.id, { title: mission.title })
    return { ...mission, prdPath }
  }

  approveMission(missionId: string, by: string = 'operator'): Mission {
    const mission = this.db.getMission(missionId)
    if (!mission) throw new Error(`Mission ${missionId} not found`)
    validateMissionTransition(mission.status, 'pending_approval')
    this.db.updateMissionStatus(missionId, 'pending_approval')
    this.gate.requireApproval('mission', missionId, 'Mission requires approval before execution')
    const approvals = this.gate.getPendingApprovals().filter((a) => a.entityId === missionId)
    if (approvals[0]) this.gate.approve(approvals[0].id, by)
    validateMissionTransition('pending_approval', 'approved')
    this.db.updateMissionStatus(missionId, 'approved')
    this.db.insertEvent('mission.status_changed', 'mission', missionId, { from: 'draft', to: 'approved', by })
    return this.db.getMission(missionId)!
  }

  canExecute(missionId: string): boolean {
    const m = this.db.getMission(missionId)
    return m?.status === 'approved'
  }

  getPrdPath(missionId: string): string {
    return join(this.stateDir, 'prd', `${missionId}.md`)
  }

  getPrdContent(missionId: string): string | null {
    const p = this.getPrdPath(missionId)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }
}
