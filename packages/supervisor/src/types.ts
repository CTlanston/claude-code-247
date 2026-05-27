export type SupervisorBackend = 'launchd' | 'systemd' | 'compose'

export interface SupervisorService {
  label: string
  /** Full path of the binary or entrypoint. */
  exec: string
  /** Optional args to pass. */
  args?: string[]
  workingDir?: string
  env?: Record<string, string>
}

export type ServiceState = 'running' | 'stopped' | 'unknown' | 'not_installed'

export interface SupervisorAdapter {
  readonly backend: SupervisorBackend
  install(svc: SupervisorService): Promise<{ artifactPath: string; content: string }>
  status(svc: SupervisorService): Promise<ServiceState>
  restart(svc: SupervisorService): Promise<void>
  uninstall(svc: SupervisorService): Promise<{ removedPath: string }>
}

/** Lifecycle calls go through a transport — real subprocess in prod, in-memory in tests. */
export interface SupervisorTransport {
  /** Execute a shell command; resolves with stdout. Throws on non-zero exit. */
  exec(cmd: string, args: string[]): Promise<string>
  /** Write file at path (creates dirs). */
  writeFile(path: string, content: string): Promise<void>
  /** Remove file at path (idempotent — missing file = no-op). */
  removeFile(path: string): Promise<void>
  /** True iff the file exists. */
  exists(path: string): Promise<boolean>
}
