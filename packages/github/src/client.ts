import { Octokit } from '@octokit/rest'

export function createOctokit(token?: string): Octokit {
  const t = token ?? process.env['AEDEV_GITHUB_TOKEN']
  if (!t) throw new Error('GitHub token required. Set AEDEV_GITHUB_TOKEN or pass token explicitly.')
  return new Octokit({ auth: t })
}

export type { Octokit }
