import type { ServiceState, SupervisorAdapter, SupervisorService, SupervisorTransport } from './types.js'

function escape(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

export class LaunchdAdapter implements SupervisorAdapter {
  readonly backend = 'launchd' as const
  constructor(
    private readonly transport: SupervisorTransport,
    private readonly plistDir = `${process.env.HOME ?? '/tmp'}/Library/LaunchAgents`,
  ) {}

  private plistPath(label: string): string {
    return `${this.plistDir}/${label}.plist`
  }

  buildPlist(svc: SupervisorService): string {
    const args = (svc.args ?? []).map((a) => `    <string>${escape(a)}</string>`).join('\n')
    const env = Object.entries(svc.env ?? {})
      .map(([k, v]) => `    <key>${escape(k)}</key>\n    <string>${escape(v)}</string>`)
      .join('\n')
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${escape(svc.label)}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${escape(svc.exec)}</string>
${args}
  </array>
  <key>KeepAlive</key><true/>
  <key>RunAtLoad</key><true/>
${svc.workingDir ? `  <key>WorkingDirectory</key><string>${escape(svc.workingDir)}</string>` : ''}
${env ? `  <key>EnvironmentVariables</key>\n  <dict>\n${env}\n  </dict>` : ''}
</dict>
</plist>
`
  }

  async install(svc: SupervisorService) {
    const path = this.plistPath(svc.label)
    const content = this.buildPlist(svc)
    await this.transport.writeFile(path, content)
    await this.transport.exec('launchctl', ['load', path]).catch(() => undefined)
    return { artifactPath: path, content }
  }

  async status(svc: SupervisorService): Promise<ServiceState> {
    if (!(await this.transport.exists(this.plistPath(svc.label)))) return 'not_installed'
    const out = await this.transport.exec('launchctl', ['list']).catch(() => '')
    return out.includes(svc.label) ? 'running' : 'stopped'
  }

  async restart(svc: SupervisorService): Promise<void> {
    await this.transport.exec('launchctl', ['unload', this.plistPath(svc.label)]).catch(() => undefined)
    await this.transport.exec('launchctl', ['load', this.plistPath(svc.label)])
  }

  async uninstall(svc: SupervisorService) {
    const path = this.plistPath(svc.label)
    await this.transport.exec('launchctl', ['unload', path]).catch(() => undefined)
    await this.transport.removeFile(path)
    return { removedPath: path }
  }
}
