import type { Octokit } from './client.js'

export interface CreatePrOptions {
  owner: string
  repo: string
  title: string
  body: string
  head: string      // branch name
  base: string      // target branch (default branch)
  draft?: boolean
}

export interface PrInfo {
  number: number
  url: string
  state: string
}

export class PrManager {
  constructor(private octokit: Octokit) {}

  async createPr(opts: CreatePrOptions): Promise<PrInfo> {
    const { data } = await this.octokit.rest.pulls.create({
      owner: opts.owner, repo: opts.repo,
      title: opts.title, body: opts.body,
      head: opts.head, base: opts.base,
      draft: opts.draft ?? false,
    })
    return { number: data.number, url: data.html_url, state: data.state }
  }

  async addComment(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.octokit.rest.issues.createComment({ owner, repo, issue_number: prNumber, body })
  }

  async updatePrBody(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    await this.octokit.rest.pulls.update({ owner, repo, pull_number: prNumber, body })
  }
}
