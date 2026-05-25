import type { AedevDb } from '@aedev/core'
import { PrManager } from './pr-manager.js'
import { CheckManager } from './check-manager.js'
import { IssueImporter } from './issue-importer.js'
import type { Octokit } from './client.js'

export interface SyncConfig {
  owner: string
  repo: string
  defaultBranch: string
}

export interface SyncResult {
  missionId: string
  prNumber: number
  prUrl: string
  branchName: string
}

export class GitHubSync {
  private pr: PrManager
  private checks: CheckManager
  private issues: IssueImporter

  constructor(private db: AedevDb, private octokit: Octokit) {
    this.pr = new PrManager(octokit)
    this.checks = new CheckManager(octokit)
    this.issues = new IssueImporter(octokit)
  }

  buildEvidenceSummary(missionId: string): string {
    const mission = this.db.getMission(missionId)
    if (!mission) throw new Error(`Mission ${missionId} not found`)
    const tasks = this.db.listTasks(missionId)
    const validators = tasks.flatMap((t) => this.db.listValidatorResults(t.id))
    const lines = [
      `## Mission: ${mission.title}`,
      `**Status:** ${mission.status}`,
      `**Tasks:** ${tasks.length} (${tasks.filter((t) => t.status === 'done').length} done)`,
      '',
      '### Validator Results',
      validators.length === 0
        ? '_No validator results yet_'
        : validators.map((v) => `- **${v.validator}**: ${v.verdict} — ${v.summary ?? ''}`).join('\n'),
    ]
    return lines.join('\n')
  }

  async syncMission(missionId: string, cfg: SyncConfig): Promise<SyncResult> {
    const mission = this.db.getMission(missionId)
    if (!mission) throw new Error(`Mission ${missionId} not found`)

    const branchName = `aedev/${missionId.slice(-8)}`
    const body = this.buildEvidenceSummary(missionId)

    const pr = await this.pr.createPr({
      owner: cfg.owner, repo: cfg.repo,
      title: mission.title,
      body,
      head: branchName,
      base: cfg.defaultBranch,
      draft: true,
    })

    this.db.updateMissionGitHub(missionId, {
      githubBranch: branchName,
      githubPrUrl: pr.url,
      githubPrNumber: pr.number,
    })
    this.db.insertEvent('mission.status_changed', 'mission', missionId, {
      action: 'github_synced', prUrl: pr.url,
    })

    return { missionId, prNumber: pr.number, prUrl: pr.url, branchName }
  }

  async importIssue(owner: string, repo: string, issueNumber: number, repoId: string): Promise<string> {
    const issue = await this.issues.fetchIssue(owner, repo, issueNumber)
    const mission = this.db.insertMission({
      repoId, title: issue.title,
      description: `Imported from GitHub issue #${issue.number}: ${issue.url}\n\n${issue.body}`,
      status: 'draft',
    })
    this.db.insertEvent('mission.created', 'mission', mission.id, {
      source: 'github_issue', issueNumber, issueUrl: issue.url,
    })
    return mission.id
  }
}
