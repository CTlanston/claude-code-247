import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'
import { createOctokit, GitHubSync } from '@aedev/github'
import { allowRemoteWritesEnabled } from '../remote-write-policy.js'

export function registerGitHubRoutes(app: FastifyInstance, db: AedevDb, stateDir: string): void {
  app.post<{ Params: { missionId: string }; Body: { owner: string; repo: string; defaultBranch?: string } }>(
    '/github/sync/:missionId', async (req, reply) => {
      // CLAUDE.md non-negotiable #2: no GitHub write API call may execute unless
      // system.allow_remote_writes is true. Fail closed BEFORE constructing the
      // octokit client or touching the network — this route opens a real PR.
      if (!allowRemoteWritesEnabled(stateDir)) {
        db.insertEvent('github.sync_blocked', 'mission', req.params.missionId, {
          code: 'REMOTE_WRITES_DISABLED',
          reason: 'system.allow_remote_writes=false blocks GitHub PR creation',
        })
        return reply.code(403).send({ error: 'REMOTE_WRITES_DISABLED: system.allow_remote_writes=false blocks GitHub PR creation' })
      }
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

  // import-issue only READS a GitHub issue and creates a local mission — it
  // performs no outward write, so it is not gated by allow_remote_writes.
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
