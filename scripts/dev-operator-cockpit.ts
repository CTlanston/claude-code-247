import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { delimiter, dirname } from 'node:path'

const ROOT = process.cwd()
const DAEMON_PORT = 7247
const DASHBOARD_PORT = 7248
const replace = process.argv.includes('--replace')

function listenerPid(port: number): number | undefined {
  try {
    const out = execFileSync('lsof', ['-tiTCP:' + port, '-sTCP:LISTEN'], { encoding: 'utf8' }).trim()
    const first = out.split(/\s+/).filter(Boolean)[0]
    return first ? Number(first) : undefined
  } catch {
    return undefined
  }
}

function commandFor(pid: number): string {
  try {
    return execFileSync('ps', ['-p', String(pid), '-o', 'command='], { encoding: 'utf8' }).trim()
  } catch {
    return ''
  }
}

function cwdFor(pid: number): string {
  try {
    const out = execFileSync('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn'], { encoding: 'utf8' })
    return out.split('\n').find((line) => line.startsWith('n'))?.slice(1) ?? ''
  } catch {
    return ''
  }
}

function repoOwned(pid: number, command: string, kind: 'daemon' | 'dashboard'): boolean {
  const cwd = cwdFor(pid)
  if (!command.includes(ROOT) && cwd !== ROOT && !cwd.startsWith(`${ROOT}/`)) return false
  if (kind === 'daemon') return command.includes('packages/daemon/src/main.ts')
  return command.includes('vite') && command.includes('7248')
}

async function stopPort(port: number, kind: 'daemon' | 'dashboard'): Promise<void> {
  const pid = listenerPid(port)
  if (!pid) return
  const command = commandFor(pid)
  if (!replace || !repoOwned(pid, command, kind)) {
    throw new Error(`Port ${port} is already in use by PID ${pid}: ${command}\nRun with --replace to stop repo-owned dev processes.`)
  }
  process.kill(pid, 'SIGTERM')
  const deadline = Date.now() + 5000
  while (listenerPid(port) && Date.now() < deadline) await sleep(100)
  if (listenerPid(port)) process.kill(pid, 'SIGKILL')
}

function start(name: string, command: string, args: string[]): ChildProcess {
  const nodeBin = dirname(process.execPath)
  const path = [nodeBin, process.env['PATH']].filter(Boolean).join(delimiter)
  const child = spawn(command, args, {
    cwd: ROOT,
    env: {
      ...process.env,
      PATH: path,
      AEDEV_COCKPIT_PLANNER_PROVIDER: process.env['AEDEV_COCKPIT_PLANNER_PROVIDER'] ?? 'codex',
      AEDEV_COCKPIT_AI_TIMEOUT_MS: process.env['AEDEV_COCKPIT_AI_TIMEOUT_MS'] ?? '300000',
      AEDEV_COCKPIT_WORKER_TIMEOUT_MS: process.env['AEDEV_COCKPIT_WORKER_TIMEOUT_MS'] ?? '600000',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  child.stdout?.on('data', (chunk) => process.stdout.write(`[${name}] ${chunk}`))
  child.stderr?.on('data', (chunk) => process.stderr.write(`[${name}] ${chunk}`))
  child.on('exit', (code, signal) => {
    if (code !== 0 && signal !== 'SIGTERM') console.error(`[${name}] exited code=${code} signal=${signal ?? ''}`)
  })
  return child
}

async function waitFor(url: string, ok: (res: Response) => boolean): Promise<void> {
  const deadline = Date.now() + 15_000
  let last = ''
  while (Date.now() < deadline) {
    try {
      const res = await fetch(url)
      if (ok(res)) return
      last = `${res.status} ${res.statusText}`
    } catch (e) {
      last = (e as Error).message
    }
    await sleep(200)
  }
  throw new Error(`Timed out waiting for ${url}: ${last}`)
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function main(): Promise<void> {
  await stopPort(DAEMON_PORT, 'daemon')
  await stopPort(DASHBOARD_PORT, 'dashboard')

  const children: ChildProcess[] = []
  const shutdown = () => {
    for (const child of children) {
      if (!child.killed) child.kill('SIGTERM')
    }
  }
  process.on('SIGINT', () => { shutdown(); process.exit(0) })
  process.on('SIGTERM', () => { shutdown(); process.exit(0) })

  children.push(start('daemon', 'pnpm', ['tsx', 'packages/daemon/src/main.ts']))
  await waitFor(`http://127.0.0.1:${DAEMON_PORT}/operator/sessions`, (res) => res.status === 200)

  children.push(start('dashboard', 'pnpm', ['--dir', 'apps/dashboard', 'dev', '--host', '127.0.0.1', '--port', String(DASHBOARD_PORT)]))
  await waitFor(`http://127.0.0.1:${DASHBOARD_PORT}/`, (res) => res.status === 200)

  console.log(`\nOperator Cockpit ready: http://localhost:${DASHBOARD_PORT}`)
  console.log(`Daemon operator API verified: http://localhost:${DAEMON_PORT}/operator/sessions`)
}

main().catch((e) => {
  console.error((e as Error).message)
  process.exit(1)
})
