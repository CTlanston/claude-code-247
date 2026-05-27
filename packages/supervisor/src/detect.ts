import type { SupervisorBackend, SupervisorTransport, SupervisorAdapter } from './types.js'
import { LaunchdAdapter } from './launchd.js'
import { SystemdAdapter } from './systemd.js'
import { ComposeAdapter } from './compose.js'

export interface DetectOpts {
  /** Optional override (e.g., from config.yaml or env). */
  preferred?: SupervisorBackend
  /** OS hint; defaults to process.platform. */
  platform?: NodeJS.Platform
  /** When true, prefer docker-compose even if launchd/systemd are available. */
  preferDocker?: boolean
}

/**
 * Decide which adapter to use based on OS + config + capability probes.
 *
 *  - Darwin → launchd
 *  - Linux + systemctl on PATH → systemd
 *  - Anywhere docker exists and config opts in → compose
 *  - Otherwise → throw (operator must specify)
 */
export async function detectBackend(
  transport: SupervisorTransport,
  opts: DetectOpts = {},
): Promise<SupervisorBackend> {
  if (opts.preferred) return opts.preferred
  if (opts.preferDocker) {
    try { await transport.exec('docker', ['--version']); return 'compose' } catch { /* fall through */ }
  }
  const plat = opts.platform ?? process.platform
  if (plat === 'darwin') return 'launchd'
  if (plat === 'linux') {
    try { await transport.exec('systemctl', ['--version']); return 'systemd' } catch { /* fall through */ }
  }
  try { await transport.exec('docker', ['--version']); return 'compose' } catch { /* fall through */ }
  throw new Error(`no supported supervisor backend on platform=${plat}`)
}

export async function adapterFor(
  transport: SupervisorTransport,
  opts: DetectOpts = {},
): Promise<SupervisorAdapter> {
  const backend = await detectBackend(transport, opts)
  switch (backend) {
    case 'launchd': return new LaunchdAdapter(transport)
    case 'systemd': return new SystemdAdapter(transport)
    case 'compose': return new ComposeAdapter(transport)
  }
}
