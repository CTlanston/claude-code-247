import { Command } from 'commander'
import { execFile } from 'child_process'
import { promisify } from 'util'
import { existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const execFileAsync = promisify(execFile)

interface Check { name: string; status: 'ok' | 'warn' | 'fail'; detail?: string }

async function probe(bin: string, args: string[]): Promise<{ ok: boolean; out?: string }> {
  try {
    const { stdout } = await execFileAsync(bin, args, { timeout: 5000 })
    return { ok: true, out: stdout.trim() }
  } catch {
    return { ok: false }
  }
}

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('Verify the local aedev environment (claude CLI, docker, python, AEDEV_HOME)')
    .option('--plain', 'Plain key=value output')
    .action(async (opts: { plain?: boolean }) => {
      const checks: Check[] = []

      const claude = await probe('which', ['claude'])
      checks.push({
        name: 'claude CLI on PATH',
        status: claude.ok ? 'ok' : 'warn',
        detail: claude.ok ? claude.out : 'install Claude Code CLI to enable real worker mode',
      })

      const docker = await probe('docker', ['info'])
      checks.push({
        name: 'docker daemon',
        status: docker.ok ? 'ok' : 'warn',
        detail: docker.ok ? 'reachable' : 'docker not running — DockerRunner cannot launch containers',
      })

      const python = await probe('python3', ['--version'])
      checks.push({
        name: 'python3',
        status: python.ok ? 'ok' : 'warn',
        detail: python.ok ? python.out : 'python3 needed for claude247 bridge',
      })

      const claude247 = await probe('which', ['claude247'])
      checks.push({
        name: 'claude247 CLI',
        status: claude247.ok ? 'ok' : 'warn',
        detail: claude247.ok ? claude247.out : 'install the Python kernel to enable the bridge',
      })

      const aedevHome = process.env['AEDEV_HOME'] ?? join(homedir(), '.aedev')
      checks.push({
        name: 'AEDEV_HOME',
        status: existsSync(aedevHome) ? 'ok' : 'warn',
        detail: existsSync(aedevHome) ? aedevHome : `${aedevHome} does not exist — run \`aedev init\``,
      })

      const daemonUrl = process.env['AEDEV_DAEMON_URL'] ?? 'http://127.0.0.1:7247'
      try {
        const r = await fetch(`${daemonUrl}/healthz`, { signal: AbortSignal.timeout(2000) })
        checks.push({
          name: 'aedev daemon',
          status: r.ok ? 'ok' : 'warn',
          detail: r.ok ? `${daemonUrl} healthy` : `${daemonUrl} returned ${r.status}`,
        })
      } catch {
        checks.push({ name: 'aedev daemon', status: 'warn', detail: `${daemonUrl} unreachable (run \`aedev daemon start\`)` })
      }

      let exit = 0
      if (opts.plain) {
        for (const c of checks) console.log(`${c.name}=${c.status}${c.detail ? `;${c.detail}` : ''}`)
      } else {
        for (const c of checks) {
          const icon = c.status === 'ok' ? '✅' : c.status === 'warn' ? '⚠️ ' : '❌'
          console.log(`${icon} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`)
        }
      }
      if (checks.some((c) => c.status === 'fail')) exit = 1
      if (exit !== 0) process.exit(exit)
    })
}
