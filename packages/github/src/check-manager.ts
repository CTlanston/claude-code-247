import type { Octokit } from './client.js'

export type CheckConclusion = 'success' | 'failure' | 'neutral' | 'skipped'

export class CheckManager {
  constructor(private octokit: Octokit) {}

  async createCheckRun(owner: string, repo: string, opts: {
    name: string; headSha: string; status: 'queued' | 'in_progress' | 'completed';
    conclusion?: CheckConclusion; title: string; summary: string
  }): Promise<number> {
    const { data } = await this.octokit.rest.checks.create({
      owner, repo, name: opts.name, head_sha: opts.headSha, status: opts.status,
      ...(opts.conclusion ? { conclusion: opts.conclusion } : {}),
      output: { title: opts.title, summary: opts.summary },
    })
    return data.id
  }

  async updateCheckRun(owner: string, repo: string, checkRunId: number, opts: {
    status: 'completed'; conclusion: CheckConclusion; title: string; summary: string
  }): Promise<void> {
    await this.octokit.rest.checks.update({
      owner, repo, check_run_id: checkRunId,
      status: opts.status, conclusion: opts.conclusion,
      output: { title: opts.title, summary: opts.summary },
    })
  }
}
