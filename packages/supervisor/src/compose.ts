import type { ServiceState, SupervisorAdapter, SupervisorService, SupervisorTransport } from './types.js'

export class ComposeAdapter implements SupervisorAdapter {
  readonly backend = 'compose' as const
  constructor(
    private readonly transport: SupervisorTransport,
    private readonly composeDir = `${process.env.HOME ?? '/tmp'}/.aedev/compose`,
  ) {}

  private composePath(label: string): string {
    return `${this.composeDir}/${label}.docker-compose.yml`
  }

  buildCompose(svc: SupervisorService): string {
    const env = Object.entries(svc.env ?? {})
      .map(([k, v]) => `      ${k}: ${JSON.stringify(v)}`)
      .join('\n')
    const args = (svc.args ?? []).map((a) => `      - ${JSON.stringify(a)}`).join('\n')
    return `services:
  ${svc.label}:
    image: node:20-alpine
    restart: unless-stopped
    command:
      - ${JSON.stringify(svc.exec)}
${args}
    working_dir: ${svc.workingDir ?? '/app'}
    environment:
${env}
`
  }

  async install(svc: SupervisorService) {
    const path = this.composePath(svc.label)
    const content = this.buildCompose(svc)
    await this.transport.writeFile(path, content)
    await this.transport.exec('docker', ['compose', '-f', path, 'up', '-d']).catch(() => undefined)
    return { artifactPath: path, content }
  }

  async status(svc: SupervisorService): Promise<ServiceState> {
    if (!(await this.transport.exists(this.composePath(svc.label)))) return 'not_installed'
    try {
      const out = await this.transport.exec('docker', ['compose', '-f', this.composePath(svc.label), 'ps', '--format', 'json'])
      return out.includes('"State":"running"') ? 'running' : 'stopped'
    } catch {
      return 'unknown'
    }
  }

  async restart(svc: SupervisorService): Promise<void> {
    await this.transport.exec('docker', ['compose', '-f', this.composePath(svc.label), 'restart'])
  }

  async uninstall(svc: SupervisorService) {
    const path = this.composePath(svc.label)
    await this.transport.exec('docker', ['compose', '-f', path, 'down']).catch(() => undefined)
    await this.transport.removeFile(path)
    return { removedPath: path }
  }
}
