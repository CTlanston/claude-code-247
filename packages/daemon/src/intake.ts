import { mkdirSync, writeFileSync, existsSync, readFileSync } from 'fs'
import { join } from 'path'
import type { AedevDb, Mission, MissionDesign } from '@aedev/core'
import { validateMissionTransition } from '@aedev/core'
import { LeadAgent } from './lead-agent.js'
import { ApprovalGate } from './approval.js'
import { ClarificationGate } from './clarification-gate.js'

/**
 * IntakeService handles the three-step mission lifecycle:
 *
 *   1. createMissionCandidate() → status: draft
 *      Writes a PRD template; the mission is not yet executable.
 *
 *   2. requestApproval() → status: pending_approval
 *      Creates a pending approval record. A human (or external gate) must
 *      then explicitly call approveMission() — no self-approval.
 *
 *   3. approveMission() → status: approved
 *      Marks the existing pending approval record as approved and transitions
 *      the mission to approved. Only after this call does canExecute() return true.
 */
export class IntakeService {
  private agent: LeadAgent
  private gate: ApprovalGate

  constructor(
    private db: AedevDb,
    private stateDir: string,
    /**
     * Optional Structured Clarification Gate (ADR-0020).  When provided,
     * createMissionCandidate runs it after synthesizing the PRD: ambiguous
     * missions get `mission.clarification.requested` + persisted questions
     * before approval.  Omitted in callers/tests that don't need clarification,
     * so default behavior is unchanged.
     */
    private clarificationGate?: ClarificationGate,
  ) {
    this.agent = new LeadAgent(stateDir)
    this.gate = new ApprovalGate(db)
  }

  /** Step 1 — create a draft mission and write a PRD template file. */
  createMissionCandidate(repoId: string, description: string, title?: string): Mission {
    // Note: repoId may be 'unknown' if no repos registered yet
    const mission = this.db.insertMission({
      repoId, title: title ?? description.slice(0, 80),
      description, status: 'draft',
    })
    const prdDir = join(this.stateDir, 'prd')
    mkdirSync(prdDir, { recursive: true })
    const prdPath = join(prdDir, `${mission.id}.md`)
    const design = this.agent.designMission(mission.id, description, mission.title)
    const prdContent = this.agent.renderDesignMarkdown(design)
    writeFileSync(prdPath, prdContent)
    writeFileSync(this.getDesignPath(mission.id), JSON.stringify(design, null, 2))
    this.db.insertEvent('mission.created', 'mission', mission.id, { title: mission.title, designPath: this.getDesignPath(mission.id) })

    // ADR-0020: ambiguous missions get clarification questions before approval.
    if (this.clarificationGate) {
      const evaluation = this.clarificationGate.evaluate({ title: mission.title, description }, design)
      if (evaluation.required) {
        this.clarificationGate.request(mission.id, evaluation)
      }
    }
    return { ...mission, prdPath }
  }

  /** True iff a clarification gate is configured and flagged this mission as ambiguous (questions pending answers). */
  needsClarification(missionId: string): boolean {
    return this.clarificationGate?.status(missionId) === 'requested'
  }

  /**
   * Step 2 — request human approval.
   * Moves mission draft → pending_approval and inserts a pending approval record.
   * Does NOT auto-approve. The caller must later invoke approveMission().
   */
  requestApproval(missionId: string): Mission {
    const mission = this.db.getMission(missionId)
    if (!mission) throw new Error(`Mission ${missionId} not found`)
    validateMissionTransition(mission.status, 'pending_approval')
    this.db.updateMissionStatus(missionId, 'pending_approval')
    this.gate.requireApproval('mission', missionId, 'Mission requires human approval before execution')
    this.db.insertEvent('mission.status_changed', 'mission', missionId, {
      from: mission.status, to: 'pending_approval',
    })
    return this.db.getMission(missionId)!
  }

  /**
   * Step 3 — explicitly approve a pending mission.
   * Finds the existing pending approval record (created by requestApproval),
   * marks it approved, and transitions the mission to approved.
   * Throws if no pending approval record exists — requestApproval must be
   * called first (no self-approval shortcut).
   */
  approveMission(missionId: string, by: string = 'operator'): Mission {
    const mission = this.db.getMission(missionId)
    if (!mission) throw new Error(`Mission ${missionId} not found`)
    if (mission.status !== 'pending_approval') {
      throw new Error(
        `Mission ${missionId} must be in pending_approval status before it can be approved ` +
        `(current status: ${mission.status}). Call requestApproval() first.`,
      )
    }
    // Find the pending approval record created by requestApproval()
    const pending = this.gate.getPendingApprovals().find((a) => a.entityId === missionId)
    if (!pending) {
      throw new Error(
        `No pending approval record found for mission ${missionId}. ` +
        `Call requestApproval() to create one before calling approveMission().`,
      )
    }
    this.gate.approve(pending.id, by)
    validateMissionTransition('pending_approval', 'approved')
    this.db.updateMissionStatus(missionId, 'approved')
    this.db.insertEvent('mission.status_changed', 'mission', missionId, {
      from: 'pending_approval', to: 'approved', by,
    })
    return this.db.getMission(missionId)!
  }

  /** Returns true only when mission status is 'approved'. */
  canExecute(missionId: string): boolean {
    const m = this.db.getMission(missionId)
    return m?.status === 'approved'
  }

  getPrdPath(missionId: string): string {
    return join(this.stateDir, 'prd', `${missionId}.md`)
  }

  getDesignPath(missionId: string): string {
    return join(this.stateDir, 'prd', `${missionId}.design.json`)
  }

  getPrdContent(missionId: string): string | null {
    const p = this.getPrdPath(missionId)
    return existsSync(p) ? readFileSync(p, 'utf8') : null
  }

  getDesign(missionId: string): MissionDesign | null {
    const p = this.getDesignPath(missionId)
    if (!existsSync(p)) return null
    return JSON.parse(readFileSync(p, 'utf8')) as MissionDesign
  }
}
