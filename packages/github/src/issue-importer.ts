import type { Octokit } from './client.js'

export interface ImportedIssue {
  number: number
  title: string
  body: string
  url: string
  labels: string[]
}

export class IssueImporter {
  constructor(private octokit: Octokit) {}

  async fetchIssue(owner: string, repo: string, issueNumber: number): Promise<ImportedIssue> {
    const { data } = await this.octokit.rest.issues.get({ owner, repo, issue_number: issueNumber })
    return {
      number: data.number,
      title: data.title,
      body: data.body ?? '',
      url: data.html_url,
      labels: data.labels.map((l) => (typeof l === 'string' ? l : l.name ?? '')).filter(Boolean),
    }
  }
}
