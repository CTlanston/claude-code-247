import type { TaskStatus, MissionStatus } from './schema.js'

const TASK_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  pending:   ['running', 'cancelled'],
  running:   ['done', 'failed', 'hold'],
  hold:      ['pending', 'cancelled'],
  done:      [],
  failed:    ['pending'],
  cancelled: [],
}

const MISSION_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  draft:            ['pending_approval', 'cancelled'],
  pending_approval: ['approved', 'cancelled'],
  approved:         ['running', 'cancelled'],
  running:          ['done', 'failed', 'paused'],
  paused:           ['running', 'cancelled'],
  done:             [],
  failed:           ['approved'],
  cancelled:        [],
}

export function validateTaskTransition(from: TaskStatus, to: TaskStatus): void {
  if (!TASK_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid task transition: ${from} → ${to}`)
  }
}

export function validateMissionTransition(from: MissionStatus, to: MissionStatus): void {
  if (!MISSION_TRANSITIONS[from]?.includes(to)) {
    throw new Error(`Invalid mission transition: ${from} → ${to}`)
  }
}
