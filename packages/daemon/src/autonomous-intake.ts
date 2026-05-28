import { existsSync } from 'fs'
import type { AedevDb, Mission, Repo } from '@aedev/core'
import type { MissionIntakeSourceOptions } from './mission-intake-source.js'
import {
  MissionIntakeSource,
  type ClassifiedIntakeCandidate,
} from './mission-intake-source.js'
import { IntakeService } from './intake.js'

const CANDIDATE_MARKER = 'MissionIntakeCandidate:'

export interface AutonomousIntakeScanOptions {
  repoId?: string
}

export interface AutonomousIntakeServiceOptions {
  capPerRepo?: number
  githubToken?: string
  sourceFactory?: (
    repo: Repo,
    options: MissionIntakeSourceOptions,
  ) => MissionIntakeSource | Promise<MissionIntakeSource>
}

export interface MaterializedIntakeMission {
  candidateId: string
  source: ClassifiedIntakeCandidate['source']
  decision: ClassifiedIntakeCandidate['decision']
  reason: string
  action: 'created' | 'duplicate' | 'blocked'
  missionId?: string
  missionStatus?: Mission['status']
}

export interface AutonomousIntakeScanResult {
  reposScanned: number
  candidatesDiscovered: number
  created: number
  duplicates: number
  blocked: number
  overflow: number
  holds: Array<{ repoId: string; holdCode: 'HOLD-FLOOD'; detail: string }>
  missions: MaterializedIntakeMission[]
}

export class AutonomousIntakeService {
  constructor(
    private readonly db: AedevDb,
    private readonly stateDir: string,
    private readonly opts: AutonomousIntakeServiceOptions = {},
  ) {}

  async scan(scanOpts: AutonomousIntakeScanOptions = {}): Promise<AutonomousIntakeScanResult> {
    const repos = this.db.listRepos()
      .filter((repo) => repo.enabled)
      .filter((repo) => !scanOpts.repoId || repo.id === scanOpts.repoId)
    const intake = new IntakeService(this.db, this.stateDir)
    const missions: MaterializedIntakeMission[] = []
    let candidatesDiscovered = 0
    let created = 0
    let duplicates = 0
    let blocked = 0
    let overflow = 0
    const holds: AutonomousIntakeScanResult['holds'] = []

    for (const repo of repos) {
      const source = await this.buildSource(repo)
      const result = await source.scan()
      candidatesDiscovered += result.candidates.length
      overflow += result.overflow.length
      if (result.overflow.length > 0) {
        const hold = {
          repoId: repo.id,
          holdCode: 'HOLD-FLOOD' as const,
          detail: `intake scan found ${result.candidates.length} candidates; cap ${result.cap} overflowed ${result.overflow.length}`,
        }
        holds.push(hold)
        this.db.insertEvent('hold.policy.created', 'repo', repo.id, {
          holdCode: hold.holdCode,
          reason: 'intake_overflow',
          candidates: result.candidates.length,
          cap: result.cap,
          overflow: result.overflow.length,
        })
      }

      for (const candidate of result.accepted) {
        if (candidate.decision === 'blocked') {
          blocked++
          missions.push({
            candidateId: candidate.id,
            source: candidate.source,
            decision: candidate.decision,
            reason: candidate.reason,
            action: 'blocked',
          })
          continue
        }

        const duplicate = this.findExistingMission(repo.id, candidate.id)
        if (duplicate) {
          duplicates++
          missions.push({
            candidateId: candidate.id,
            source: candidate.source,
            decision: candidate.decision,
            reason: candidate.reason,
            action: 'duplicate',
            missionId: duplicate.id,
            missionStatus: duplicate.status,
          })
          continue
        }

        const mission = intake.createMissionCandidate(
          repo.id,
          renderCandidateDescription(candidate),
          candidate.title,
        )
        let missionStatus = mission.status
        if (candidate.decision === 'execute_now') {
          missionStatus = intake.requestApproval(mission.id).status
        }
        this.db.insertEvent('mission.intake_materialized', 'mission', mission.id, {
          candidateId: candidate.id,
          source: candidate.source,
          decision: candidate.decision,
          reason: candidate.reason,
        })
        created++
        missions.push({
          candidateId: candidate.id,
          source: candidate.source,
          decision: candidate.decision,
          reason: candidate.reason,
          action: 'created',
          missionId: mission.id,
          missionStatus,
        })
      }
    }

    return {
      reposScanned: repos.length,
      candidatesDiscovered,
      created,
      duplicates,
      blocked,
      overflow,
      holds,
      missions,
    }
  }

  private async buildSource(repo: Repo): Promise<MissionIntakeSource> {
    const cap = this.opts.capPerRepo ?? 10
    const options: MissionIntakeSourceOptions = {
      taskId: `intake-scan-${repo.id}`,
      cap,
      ...(repo.githubOwner && repo.githubRepo
        ? {
            github: {
              owner: repo.githubOwner,
              repo: repo.githubRepo,
              repoId: repo.id,
              limit: cap,
              token: this.opts.githubToken ?? process.env['AEDEV_GITHUB_TOKEN'],
            },
          }
        : {}),
      ...(existsSync(repo.path)
        ? {
            todo: { repoPath: repo.path, repoId: repo.id, limit: cap },
            failingTests: {
              repoPath: repo.path,
              repoId: repo.id,
              limit: cap,
              ...(repo.testCommands[0] ? { command: splitCommand(repo.testCommands[0]) } : {}),
            },
          }
        : {}),
    }
    if (this.opts.sourceFactory) {
      return await this.opts.sourceFactory(repo, options)
    }
    return new MissionIntakeSource(options)
  }

  private findExistingMission(repoId: string, candidateId: string): Mission | undefined {
    const marker = `${CANDIDATE_MARKER} ${candidateId}`
    return this.db.listMissions(repoId)
      .find((mission) => mission.description?.includes(marker))
  }
}

function renderCandidateDescription(candidate: ClassifiedIntakeCandidate): string {
  return [
    `${CANDIDATE_MARKER} ${candidate.id}`,
    `Source: ${candidate.source}`,
    `Decision: ${candidate.decision}`,
    `Reason: ${candidate.reason}`,
    '',
    candidate.body,
  ].join('\n')
}

function splitCommand(command: string): string[] {
  return command.trim().split(/\s+/).filter(Boolean)
}
