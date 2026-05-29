export type EventType =
  | 'heartbeat'
  | 'task.created' | 'task.status_changed'
  | 'mission.created' | 'mission.status_changed'
  | 'approval.created' | 'approval.decided'
  | 'run.started' | 'run.completed'
  | 'model.usage.recorded'
  | 'secret_grant.created' | 'secret_grant.revoked'

// Re-exported for convenience — callers use db.insertEvent(type, ...) directly
