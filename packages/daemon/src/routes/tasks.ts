import type { FastifyInstance } from 'fastify'
import type { AedevDb } from '@aedev/core'

/**
 * Tasks live view (Operator Cockpit P1).  Enriched with mission title, repo,
 * and the latest run so the Tasks page is a real-time execution view: running
 * tasks first, then newest.  Optional `?missionId=` filter.
 */
export function registerTaskRoutes(app: FastifyInstance, db: AedevDb): void {
  app.get<{ Querystring: { missionId?: string } }>('/tasks', async (req) => {
    const tasks = db.listTasks(req.query.missionId).map((t) => {
      const mission = db.getMission(t.missionId)
      const repo = mission ? db.getRepo(mission.repoId) : undefined
      const runs = db.listRuns(t.id) // newest-first
      const latestRun = runs[0]
      return {
        ...t,
        missionTitle: mission?.title ?? null,
        missionStatus: mission?.status ?? null,
        repoName: repo?.name ?? null,
        repoPath: repo?.path ?? null,
        runCount: runs.length,
        latestRun: latestRun
          ? {
              id: latestRun.id,
              runnerMode: latestRun.runnerMode,
              status: latestRun.status,
              exitCode: latestRun.exitCode ?? null,
              evidenceDir: latestRun.evidenceDir ?? null,
            }
          : null,
      }
    })
    // Running tasks on top (live execution), then newest first.
    tasks.sort((a, b) => {
      const ar = a.status === 'running' ? 0 : 1
      const br = b.status === 'running' ? 0 : 1
      if (ar !== br) return ar - br
      return b.createdAt.localeCompare(a.createdAt)
    })
    return { tasks }
  })

  app.get<{ Params: { id: string } }>('/tasks/:id', async (req, reply) => {
    const t = db.getTask(req.params.id)
    if (!t) return reply.code(404).send({ error: 'Not found' })
    return t
  })
}
