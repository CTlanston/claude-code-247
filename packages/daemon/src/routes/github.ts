import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'
import { createOctokit, GitHubSync } from '@aedev/github'

export function registerGitHubRoutes(app: FastifyInstance, db: AedevDb): void {
  app.post<{ Params: { missionId: string }; Body: { owner: string; repo: string; defaultBranch?: string } }>(
    '/github/sync/:missionId', async (req, reply) => {
      if (!process.env['AEDEV_GITHUB_TOKEN']) {
        return reply.code(400).send({ error: 'AEDEV_GITHUB_TOKEN not set' })
      }
      try {
        const octokit = createOctokit()
        const sync = new GitHubSync(db, octokit)
        const result = await sync.syncMission(req.params.missionId, {
          owner: req.body.owner, repo: req.body.repo,
          defaultBranch: req.body.defaultBranch ?? 'main',
        })
        return result
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message })
      }
    }
  )

  app.post<{ Body: { owner: string; repo: string; issueNumber: number; repoId?: string } }>(
    '/github/import-issue', async (req, reply) => {
      if (!process.env['AEDEV_GITHUB_TOKEN']) {
        return reply.code(400).send({ error: 'AEDEV_GITHUB_TOKEN not set' })
      }
      try {
        const octokit = createOctokit()
        const sync = new GitHubSync(db, octokit)
        const missionId = await sync.importIssue(
          req.body.owner, req.body.repo, req.body.issueNumber, req.body.repoId ?? 'unknown'
        )
        return { missionId }
      } catch (e) {
        return reply.code(400).send({ error: (e as Error).message })
      }
    }
  )
}
