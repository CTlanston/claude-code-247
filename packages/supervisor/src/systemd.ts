import type { ServiceState, SupervisorAdapter, SupervisorService, SupervisorTransport } from './types.js'

export class SystemdAdapter implements SupervisorAdapter {
  readonly backend = 'systemd' as const
  constructor(
    private readonly transport: SupervisorTransport,
    private readonly unitDir = `${process.env.HOME ?? '/tmp'}/.config/systemd/user`,
  ) {}

  private unitPath(label: string): string {
    return `${this.unitDir}/${label}.service`
  }

  buildUnit(svc: SupervisorService): string {
    const envLines = Object.entries(svc.env ?? {})
      .map(([k, v]) => `Environment=${k}=${v}`)
      .join('\n')
    const execStart = [svc.exec, ...(svc.args ?? [])].map((s) => (s.includes(' ') ? `"${s}"` : s)).join(' ')
    return `[Unit]
Description=${svc.label}
After=network.target

[Service]
Type=simple
ExecStart=${execStart}
${svc.workingDir ? `WorkingDirectory=${svc.workingDir}` : ''}
${envLines}
Restart=always
RestartSec=5

[Install]
WantedBy=default.target
`
  }

  async install(svc: SupervisorService) {
    const path = this.unitPath(svc.label)
    const content = this.buildUnit(svc)
    await this.transport.writeFile(path, content)
    await this.transport.exec('systemctl', ['--user', 'daemon-reload']).catch(() => undefined)
    await this.transport.exec('systemctl', ['--user', 'enable', '--now', svc.label]).catch(() => undefined)
    return { artifactPath: path, content }
  }

  async status(svc: SupervisorService): Promise<ServiceState> {
    if (!(await this.transport.exists(this.unitPath(svc.label)))) return 'not_installed'
    try {
      const out = await this.transport.exec('systemctl', ['--user', 'is-active', svc.label])
      return out.trim() === 'active' ? 'running' : 'stopped'
    } catch {
      return 'stopped'
    }
  }

  async restart(svc: SupervisorService): Promise<void> {
    await this.transport.exec('systemctl', ['--user', 'restart', svc.label])
  }

  async uninstall(svc: SupervisorService) {
    const path = this.unitPath(svc.label)
    await this.transport.exec('systemctl', ['--user', 'disable', '--now', svc.label]).catch(() => undefined)
    await this.transport.removeFile(path)
    await this.transport.exec('systemctl', ['--user', 'daemon-reload']).catch(() => undefined)
    return { removedPath: path }
  }
}
