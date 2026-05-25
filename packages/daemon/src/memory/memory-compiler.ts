import type { AedevDb, MemoryItem } from '@aedev/core'

export interface FailureContext {
  symptom: string
  errorMessage?: string
  relatedTaskId?: string
  relatedMissionId?: string
  repoId?: string
}

export class MemoryCompiler {
  constructor(private db: AedevDb) {}

  createFromFailed(context: FailureContext): MemoryItem {
    const content = [
      `Symptom: ${context.symptom}`,
      `Root cause: ${context.errorMessage ?? 'unknown'}`,
      `Prevention rule: Investigate before re-running this type of task.`,
      `Related task: ${context.relatedTaskId ?? 'none'}`,
      `Related mission: ${context.relatedMissionId ?? 'none'}`,
    ].join('\n')

    return this.db.insertMemoryItem({
      type: 'failure',
      title: `Failure: ${context.symptom.slice(0, 60)}`,
      content,
      sourceTaskId: context.relatedTaskId,
      sourceMissionId: context.relatedMissionId,
      repoId: context.repoId,
      approved: false,
    })
  }

  createFromDecision(title: string, content: string, opts: { taskId?: string; missionId?: string; repoId?: string } = {}): MemoryItem {
    return this.db.insertMemoryItem({
      type: 'decision',
      title,
      content,
      sourceTaskId: opts.taskId,
      sourceMissionId: opts.missionId,
      repoId: opts.repoId,
      approved: false,
    })
  }

  /** Scan failed runs in the event log and create memory candidates for any not yet recorded. */
  scanAndCompile(): MemoryItem[] {
    const failEvents = this.db.queryEvents({ type: 'run.completed' }).filter((e) => {
      const payload = e.payload as Record<string, unknown>
      return typeof payload['exitCode'] === 'number' && payload['exitCode'] !== 0
    })

    const created: MemoryItem[] = []
    const existing = this.db.listMemoryItems()
    const existingTaskIds = new Set(existing.map((m) => m.sourceTaskId).filter(Boolean))

    for (const ev of failEvents) {
      const payload = ev.payload as Record<string, unknown>
      const taskId = payload['taskId'] as string | undefined
      if (!taskId || existingTaskIds.has(taskId)) continue
      const task = this.db.getTask(taskId)
      if (!task) continue
      const item = this.createFromFailed({
        symptom: `Task "${task.title}" failed`,
        errorMessage: payload['error'] as string | undefined,
        relatedTaskId: taskId,
        relatedMissionId: task.missionId,
        repoId: task.repoId,
      })
      created.push(item)
    }
    return created
  }
}
