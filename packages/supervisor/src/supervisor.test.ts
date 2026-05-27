import { describe, it, expect } from 'vitest'
import {
  LaunchdAdapter,
  SystemdAdapter,
  ComposeAdapter,
  detectBackend,
  adapterFor,
  type SupervisorService,
  type SupervisorTransport,
} from './index.js'

/** In-memory transport: records exec calls, fakes a writable FS. */
function memTransport(): SupervisorTransport & { calls: string[]; files: Map<string, string> } {
  const calls: string[] = []
  const files = new Map<string, string>()
  return {
    calls,
    files,
    async exec(cmd, args) {
      const k = `${cmd} ${args.join(' ')}`.trim()
      calls.push(k)
      if (cmd === 'launchctl' && args[0] === 'list') return 'com.aedev.daemon 1234 0'
      if (cmd === 'systemctl' && args.includes('is-active')) return 'active'
      if (cmd === 'docker' && args[0] === '--version') return 'Docker version 25.0.0'
      if (cmd === 'systemctl' && args[1] === '--version') return 'systemd 250'
      return ''
    },
    async writeFile(p, c) {
      files.set(p, c)
    },
    async removeFile(p) {
      files.delete(p)
    },
    async exists(p) {
      return files.has(p)
    },
  }
}

const SVC: SupervisorService = {
  label: 'com.aedev.daemon',
  exec: '/usr/local/bin/aedev',
  args: ['serve'],
  workingDir: '/var/lib/aedev',
  env: { AEDEV_MODE: 'prod' },
}

describe('supervisor · launchd adapter (Stage H L1)', () => {
  it('case 1: install writes a valid plist with all fields, runs launchctl load', async () => {
    const t = memTransport()
    const a = new LaunchdAdapter(t, '/tmp/LaunchAgents')
    const { artifactPath, content } = await a.install(SVC)
    expect(artifactPath).toBe('/tmp/LaunchAgents/com.aedev.daemon.plist')
    expect(content).toContain('<key>Label</key>')
    expect(content).toContain('com.aedev.daemon')
    expect(content).toContain('serve')
    expect(content).toContain('AEDEV_MODE')
    expect(t.calls).toContain('launchctl load /tmp/LaunchAgents/com.aedev.daemon.plist')
  })

  it('case 2: status returns running when plist exists and launchctl list mentions label', async () => {
    const t = memTransport()
    const a = new LaunchdAdapter(t, '/tmp/LaunchAgents')
    await a.install(SVC)
    expect(await a.status(SVC)).toBe('running')
  })

  it('case 3: restart unloads then loads', async () => {
    const t = memTransport()
    const a = new LaunchdAdapter(t, '/tmp/LaunchAgents')
    await a.install(SVC)
    const before = t.calls.length
    await a.restart(SVC)
    const restartCalls = t.calls.slice(before)
    expect(restartCalls.find((c) => c.startsWith('launchctl unload'))).toBeDefined()
    expect(restartCalls.find((c) => c.startsWith('launchctl load'))).toBeDefined()
  })

  it('case 4: uninstall removes file + returns its path', async () => {
    const t = memTransport()
    const a = new LaunchdAdapter(t, '/tmp/LaunchAgents')
    await a.install(SVC)
    const { removedPath } = await a.uninstall(SVC)
    expect(removedPath).toBe('/tmp/LaunchAgents/com.aedev.daemon.plist')
    expect(t.files.has(removedPath)).toBe(false)
    expect(await a.status(SVC)).toBe('not_installed')
  })
})

describe('supervisor · systemd adapter (Stage H L1)', () => {
  it('case 5: install + status round-trip', async () => {
    const t = memTransport()
    const a = new SystemdAdapter(t, '/tmp/systemd')
    await a.install(SVC)
    expect(t.files.get('/tmp/systemd/com.aedev.daemon.service')).toContain('ExecStart=')
    expect(await a.status(SVC)).toBe('running')
  })

  it('case 6: uninstall removes unit file', async () => {
    const t = memTransport()
    const a = new SystemdAdapter(t, '/tmp/systemd')
    await a.install(SVC)
    await a.uninstall(SVC)
    expect(t.files.has('/tmp/systemd/com.aedev.daemon.service')).toBe(false)
  })
})

describe('supervisor · compose adapter (Stage H L1)', () => {
  it('case 7: install writes compose YAML referencing exec', async () => {
    const t = memTransport()
    const a = new ComposeAdapter(t, '/tmp/compose')
    await a.install(SVC)
    expect(t.files.get('/tmp/compose/com.aedev.daemon.docker-compose.yml')).toContain('"/usr/local/bin/aedev"')
  })
})

describe('supervisor · detect (Stage H L1)', () => {
  it('case 8: darwin → launchd', async () => {
    const t = memTransport()
    expect(await detectBackend(t, { platform: 'darwin' })).toBe('launchd')
  })

  it('case 9: linux + systemctl present → systemd', async () => {
    const t = memTransport()
    expect(await detectBackend(t, { platform: 'linux' })).toBe('systemd')
  })

  it('case 10: preferDocker → compose', async () => {
    const t = memTransport()
    expect(await detectBackend(t, { preferDocker: true })).toBe('compose')
  })

  it('case 11: adapterFor returns the right concrete class', async () => {
    const t = memTransport()
    const a = await adapterFor(t, { platform: 'darwin' })
    expect(a.backend).toBe('launchd')
  })
})
